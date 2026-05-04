// Generates quiz_template.xlsx
const xlsx = require('xlsx');
const path = require('path');

function generateTemplate(outPath) {
  const wb = xlsx.utils.book_new();
  const sheets = {
    Config: [
      { key: 'quiz_title', value: 'Kids Quiz Night' },
      { key: 'default_time_sec', value: 30 },
      { key: 'pass_decay', value: '[1, 0.5]' },
      { key: 'timer_enabled', value: true },
    ],
    Teams: [
      { name: 'Team Red', color: '#ef4444' },
      { name: 'Team Blue', color: '#3b82f6' },
      { name: 'Team Green', color: '#10b981' },
    ],
    MCQ: [
      { id: 'M1', question: 'What planet is known as the Red Planet?',
        option_a: 'Earth', option_b: 'Mars', option_c: 'Jupiter', option_d: 'Venus',
        correct: 'b', points: 10, time_sec: 20, image: '' },
      { id: 'M2', question: 'How many continents are there?',
        option_a: '5', option_b: '6', option_c: '7', option_d: '8',
        correct: 'c', points: 10, time_sec: 20, image: '' },
    ],
    RapidFire: [
      { id: 'R1', question: '2 + 2 = ?', answer: '4', points: 5, time_sec: 10 },
      { id: 'R2', question: 'Color of the sky?', answer: 'blue', points: 5, time_sec: 10 },
    ],
    PassQuestion: [
      { id: 'P1', question: 'Capital of France?', answer: 'Paris', base_points: 20, time_sec: 30, image: '' },
      { id: 'P2', question: 'Largest ocean on Earth?', answer: 'Pacific', base_points: 20, time_sec: 30, image: '' },
    ],
    ImageRound: [
      { id: 'I1', question: 'Identify this animal', answer: 'Lion', points: 15, time_sec: 20, image: 'lion.jpg' },
    ],
    Speaker: [
      { id: 'S1', question: 'Identify this speaker', answer: 'Martin Luther King Jr.', points: 20, time_sec: 30, audio: 'mlk-dream.mp3' },
      { id: 'S2', question: 'Whose voice is this?', answer: 'David Attenborough', points: 20, time_sec: 30, audio: 'attenborough.mp3' },
    ],
    Buzzer: [
      { id: 'B1', question: 'Which animal is the largest mammal on Earth?', answer: 'Blue whale', points: 20, time_sec: 20, image: '' },
      { id: 'B2', question: 'In which sport would you perform a slam dunk?', answer: 'Basketball', points: 20, time_sec: 20, image: '' },
    ],
    Rounds: [
      { round_no: 1, round_name: 'MCQ Warmup', type: 'mcq', question_ids: 'M1,M2',
        rules: '- 4 options, only one is correct\n- Correct answer: full points\n- Wrong: zero (no penalty)\n- Each team gets one question per turn' },
      { round_no: 2, round_name: 'Rapid Fire', type: 'rapidfire', question_ids: 'R1,R2',
        rules: '- 60 seconds on the clock per team\n- Answer as many as you can\n- Skip is free; wrong answers are zero' },
      { round_no: 3, round_name: 'Pass Round', type: 'pass', question_ids: 'P1,P2',
        rules: '- Each pass halves the points\n- Pass once: ½ points; twice: ¼ points; third pass: zero\n- A wrong answer ends the question' },
      { round_no: 4, round_name: 'Picture Round', type: 'image', question_ids: 'I1',
        rules: '- Identify the picture\n- Each team gets a turn\n- Pass logic applies' },
      { round_no: 5, round_name: 'Identify the Speaker', type: 'speaker', question_ids: 'S1,S2',
        rules: '- An audio clip will play\n- Identify the speaker\n- Only one playback per question' },
      { round_no: 6, round_name: 'Buzzer Showdown', type: 'buzzer', question_ids: 'B1,B2',
        rules: '- Captains, open /quiz/buzzer on your phone\n- Buzzer goes live when the question appears\n- First to press wins the chance to answer\n- Correct: +full points\n- Wrong: −half points\n- Pass: no penalty (host marks you as passed)' },
    ],
    Instructions: [
      { field: 'Sheets', detail: 'Config, Teams, MCQ, RapidFire, PassQuestion, ImageRound, Speaker, Buzzer, Rounds' },
      { field: 'MCQ correct', detail: 'Use a, b, c, or d (lowercase)' },
      { field: 'image', detail: 'Filename only; upload images separately in Admin' },
      { field: 'Speaker.audio', detail: 'Audio filename (mp3, wav, m4a, ogg, webm, aac); upload in Admin' },
      { field: 'Buzzer', detail: 'Captains buzz in from /quiz/buzzer on their phone. Correct = +full points, Wrong = −half points, Pass = free.' },
      { field: 'Rounds.question_ids', detail: 'Comma-separated ext IDs from the matching sheet' },
      { field: 'Rounds.rules', detail: 'Optional. Multi-line text shown to the audience before the round starts. Lines starting with -, *, • or "1." render as a bullet list.' },
      { field: 'pass_decay', detail: 'JSON array; index = pass count. [1,0.5] = original full, every pass 50%' },
      { field: 'timer_enabled', detail: 'true/false. When true, host sees timer controls; first pass halves the timer for the next team.' },
    ],
  };
  for (const [name, data] of Object.entries(sheets)) {
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(data), name);
  }
  const out = outPath || path.join(__dirname, 'quiz_template.xlsx');
  xlsx.writeFile(wb, out);
  return out;
}

module.exports = { generateTemplate };

if (require.main === module) {
  const out = generateTemplate();
  console.log('Wrote', out);
}
