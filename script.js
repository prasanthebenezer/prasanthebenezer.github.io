// Theme Toggle
function toggleTheme() {
    const body = document.body;
    const themeToggle = document.querySelector('.theme-toggle');

    body.classList.toggle('dark-theme');

    if (body.classList.contains('dark-theme')) {
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        localStorage.setItem('theme', 'dark');
    } else {
        themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        localStorage.setItem('theme', 'light');
    }
}

// Load saved theme
function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeToggle = document.querySelector('.theme-toggle');

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }
}

// Mobile Menu Toggle
function toggleMobileMenu() {
    const navLinks = document.getElementById('navLinks');
    const menuToggle = document.querySelector('.mobile-menu-toggle');

    navLinks.classList.toggle('active');

    // Change icon
    const icon = menuToggle.querySelector('i');
    if (navLinks.classList.contains('active')) {
        icon.className = 'fas fa-times';
    } else {
        icon.className = 'fas fa-bars';
    }
}

// Close mobile menu when link is clicked
function closeMobileMenu() {
    const navLinks = document.getElementById('navLinks');
    const menuToggle = document.querySelector('.mobile-menu-toggle');

    if (navLinks.classList.contains('active')) {
        navLinks.classList.remove('active');
        const icon = menuToggle.querySelector('i');
        icon.className = 'fas fa-bars';
    }
}

// Smooth scroll with offset for fixed nav
function smoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();

            // Close mobile menu if open
            closeMobileMenu();

            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const offsetTop = target.offsetTop - 80;
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Intersection Observer for fade-in animations
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe sections
    document.querySelectorAll('.section').forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });

    // Observe timeline items
    document.querySelectorAll('.timeline-item').forEach((item, index) => {
        item.style.opacity = '0';
        item.style.transform = 'translateX(-20px)';
        item.style.transition = `opacity 0.5s ease ${index * 0.1}s, transform 0.5s ease ${index * 0.1}s`;
        observer.observe(item);
    });

    // Observe project cards
    document.querySelectorAll('.project-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = `opacity 0.5s ease ${index * 0.1}s, transform 0.5s ease ${index * 0.1}s`;
        observer.observe(card);
    });
}

// Active nav link on scroll
function updateActiveNav() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-links a');

    let current = '';

    sections.forEach(section => {
        const sectionTop = section.offsetTop - 100;
        const sectionHeight = section.offsetHeight;

        if (window.pageYOffset >= sectionTop && window.pageYOffset < sectionTop + sectionHeight) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.style.color = '';
        if (link.getAttribute('href') === `#${current}`) {
            link.style.color = 'var(--text-primary)';
        }
    });
}

// Form submission
function handleFormSubmit() {
    const form = document.getElementById('contactForm');
    const submitBtn = document.getElementById('submit-btn');
    const formStatus = document.getElementById('form-status');

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        formStatus.textContent = '';

        try {
            const formData = new FormData(form);
            const response = await fetch(form.getAttribute('action'), {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                formStatus.textContent = 'Message sent successfully!';
                formStatus.style.color = 'var(--accent)';
                form.reset();
            } else {
                throw new Error('Network response was not ok');
            }
        } catch (error) {
            formStatus.textContent = 'Oops! Something went wrong. Please try again.';
            formStatus.style.color = '#ef4444';
            console.error('Error:', error);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Message';

            setTimeout(() => {
                formStatus.textContent = '';
            }, 5000);
        }
    });
}

// Animate stats on scroll
function animateStats() {
    const stats = document.querySelectorAll('.stat-value');
    const observerOptions = {
        threshold: 0.5
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('animated')) {
                entry.target.classList.add('animated');
                animateValue(entry.target);
            }
        });
    }, observerOptions);

    stats.forEach(stat => observer.observe(stat));
}

function animateValue(element) {
    const text = element.textContent;
    const hasPercent = text.includes('%');
    const hasCurrency = text.includes('SAR');
    const hasPlus = text.includes('+');

    let endValue = parseFloat(text.replace(/[^\d.]/g, ''));

    if (isNaN(endValue)) return;

    const duration = 1500;
    const frameDuration = 1000 / 60;
    const totalFrames = Math.round(duration / frameDuration);
    const increment = endValue / totalFrames;

    let currentValue = 0;
    let frame = 0;

    const counter = setInterval(() => {
        frame++;
        currentValue += increment;

        if (frame === totalFrames) {
            currentValue = endValue;
            clearInterval(counter);
        }

        let displayValue = Math.floor(currentValue);

        if (hasCurrency) {
            element.textContent = `SAR ${displayValue}M`;
        } else if (hasPercent) {
            element.textContent = `${displayValue}%`;
        } else if (hasPlus) {
            element.textContent = `${displayValue}+`;
        } else {
            element.textContent = displayValue;
        }
    }, frameDuration);
}

// Initialize everything
document.addEventListener('DOMContentLoaded', function() {
    loadTheme();
    smoothScroll();
    initScrollAnimations();
    handleFormSubmit();
    animateStats();

    // Update active nav on scroll
    window.addEventListener('scroll', updateActiveNav);

    // Initial call to set active nav
    updateActiveNav();
});
