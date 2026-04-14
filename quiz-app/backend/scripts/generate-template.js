// Generates quiz_template.xlsx
const xlsx = require('xlsx');
const path = require('path');

function generateTemplate(outPath) {
  const wb = xlsx.utils.book_new();
  const sheets = {
    Config: [
      { key: 'quiz_title', value: 'Kids Quiz Night' },
      { key: 'default_time_sec', value: 30 },
      { key: 'pass_decay', value: '[1, 0.5, 0.25, 0]' },
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
    Rounds: [
      { round_no: 1, round_name: 'MCQ Warmup', type: 'mcq', question_ids: 'M1,M2' },
      { round_no: 2, round_name: 'Rapid Fire', type: 'rapidfire', question_ids: 'R1,R2' },
      { round_no: 3, round_name: 'Pass Round', type: 'pass', question_ids: 'P1,P2' },
      { round_no: 4, round_name: 'Picture Round', type: 'image', question_ids: 'I1' },
    ],
    Instructions: [
      { field: 'Sheets', detail: 'Config, Teams, MCQ, RapidFire, PassQuestion, ImageRound, Rounds' },
      { field: 'MCQ correct', detail: 'Use a, b, c, or d (lowercase)' },
      { field: 'image', detail: 'Filename only; upload images separately in Admin' },
      { field: 'Rounds.question_ids', detail: 'Comma-separated ext IDs from the matching sheet' },
      { field: 'pass_decay', detail: 'JSON array; index = pass count. [1,0.5,0.25,0] = full, half, quarter, zero' },
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
