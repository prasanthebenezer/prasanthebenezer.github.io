"""Contact-form backend: verifies reCAPTCHA, then emails the message via SMTP.

Runs behind the portfolio nginx container, which proxies /api/contact here.
Configuration comes from the environment (/etc/contact-form.env on the VPS):
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, RECAPTCHA_SECRET.
Standard library only, so the image needs no pip installs.
"""
import json
import os
import re
import smtplib
import ssl
import threading
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SMTP_HOST = os.environ["SMTP_HOST"]
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ["SMTP_USER"]
SMTP_PASS = os.environ["SMTP_PASS"]
MAIL_TO = os.environ["MAIL_TO"]
RECAPTCHA_SECRET = os.environ["RECAPTCHA_SECRET"]

ALLOWED_ORIGINS = {"https://prasanthebenezer.com", "https://prasanthebenezer.github.io"}
ALLOWED_HOSTNAMES = {"prasanthebenezer.com", "prasanthebenezer.github.io"}
MAX_BODY = 32 * 1024
LIMITS = {"name": 100, "email": 254, "message": 5000}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Per-IP rate limit: at most RATE_MAX sends per RATE_WINDOW seconds.
RATE_MAX = 5
RATE_WINDOW = 3600
_sends = {}
_sends_lock = threading.Lock()


def rate_limited(ip):
    now = time.time()
    with _sends_lock:
        recent = [t for t in _sends.get(ip, []) if now - t < RATE_WINDOW]
        if len(recent) >= RATE_MAX:
            _sends[ip] = recent
            return True
        recent.append(now)
        _sends[ip] = recent
        return False


def verify_recaptcha(token, ip):
    data = urllib.parse.urlencode(
        {"secret": RECAPTCHA_SECRET, "response": token, "remoteip": ip}
    ).encode()
    with urllib.request.urlopen(
        "https://www.google.com/recaptcha/api/siteverify", data, timeout=10
    ) as resp:
        result = json.load(resp)
    return result.get("success") is True and result.get("hostname") in ALLOWED_HOSTNAMES


def send_mail(name, email, message, ip):
    msg = EmailMessage()
    msg["Subject"] = f"Portfolio contact: {name}"
    msg["From"] = formataddr(("Portfolio contact form", SMTP_USER))
    msg["To"] = MAIL_TO
    msg["Reply-To"] = formataddr((name, email))
    msg.set_content(f"Name: {name}\nEmail: {email}\nIP: {ip}\n\n{message}\n")
    with smtplib.SMTP_SSL(
        SMTP_HOST, SMTP_PORT, context=ssl.create_default_context(), timeout=20
    ) as smtp:
        smtp.login(SMTP_USER, SMTP_PASS)
        smtp.send_message(msg)


class Handler(BaseHTTPRequestHandler):
    server_version = "contact"

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"ok": False})

    def do_POST(self):
        if self.path != "/api/contact":
            return self._reply(404, {"ok": False})

        ip = self.headers.get("X-Real-IP") or self.client_address[0]
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._reply(413, {"ok": False, "error": "Message too large."})
        raw = self.rfile.read(length).decode("utf-8", "replace")

        if self.headers.get("Content-Type", "").startswith("application/json"):
            try:
                fields = {k: str(v) for k, v in json.loads(raw).items()}
            except (ValueError, AttributeError):
                return self._reply(400, {"ok": False, "error": "Bad request."})
        else:
            fields = {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}

        # Honeypot filled in: a bot. Report success and send nothing.
        if fields.get("website"):
            self.log_message("honeypot drop from %s", ip)
            return self._reply(200, {"ok": True})

        name = fields.get("name", "").strip()
        email = fields.get("email", "").strip()
        message = fields.get("message", "").strip()
        if not (name and email and message):
            return self._reply(400, {"ok": False, "error": "Please fill in every field."})
        if any(len(v) > LIMITS[k] for k, v in (("name", name), ("email", email), ("message", message))):
            return self._reply(400, {"ok": False, "error": "A field is too long."})
        if "\n" in name or "\r" in name or not EMAIL_RE.match(email):
            return self._reply(400, {"ok": False, "error": "Please check your name and email."})

        token = fields.get("g-recaptcha-response", "")
        try:
            human = bool(token) and verify_recaptcha(token, ip)
        except Exception as e:
            self.log_message("recaptcha check error: %s", e)
            return self._reply(502, {"ok": False, "error": "Could not verify the captcha."})
        if not human:
            self.log_message("captcha rejected from %s", ip)
            return self._reply(400, {"ok": False, "error": "Captcha check failed. Please try again."})

        if rate_limited(ip):
            self.log_message("rate limited %s", ip)
            return self._reply(429, {"ok": False, "error": "Too many messages. Please try later."})

        try:
            send_mail(name, email, message, ip)
        except Exception as e:
            self.log_message("send failed: %s", e)
            return self._reply(502, {"ok": False, "error": "Could not send the message."})

        self.log_message("sent message from %s", ip)
        self._reply(200, {"ok": True})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
