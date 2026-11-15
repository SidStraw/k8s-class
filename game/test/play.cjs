// 逐關套用官方解答，確認每一步都「解答前未過、解答後通過」，整關可以破關。
// 用法：node game/test/play.cjs [-v]
require('../js/sim.js');
require('../js/shell.js');
require('../js/levels.js');
require('../js/guide.js');
const G = globalThis.K8sGame;
const verbose = process.argv.includes('-v');
let fail = 0;
for (const level of G.levels) {
  if (!level.steps) {
    if (level.type === 'quiz') for (const q of level.questions) if (!(q.answer >= 0 && q.answer < q.options.length)) { fail++; console.log('✗ ' + level.id + ' 題目答案索引錯誤'); }
    continue;
  }
  let w;
  try { w = G.startLevel(level); } catch (e) { fail++; console.log('✗ ' + level.id + ' setup: ' + e.message); continue; }
  const pre = G.advance(level, w);
  if (pre) { fail++; console.log('✗ ' + level.id + ' 一開始就有 ' + pre + ' 步自動通過'); }
  let ok = true;
  for (let i = 0; i < level.steps.length; i++) {
    if (w.step > i) { fail++; ok = false; console.log('✗ ' + level.id + ' 步驟 ' + (i + 1) + ' 在執行解答前就通過了'); continue; }
    for (const s of level.steps[i].sol) {
      if (typeof s === 'object') {
        if (s.write) w.files[s.write] = s.content;
        else {
          if (!w.files[s.edit].includes(s.find)) { fail++; console.log('✗ ' + level.id + ' 步驟 ' + (i + 1) + ' 找不到要取代的文字：' + s.find); }
          w.files[s.edit] = w.files[s.edit].replace(s.find, s.to);
        }
        continue;
      }
      const cmd = typeof s === 'function' ? s(w) : s;
      const r = G.run(w, cmd);
      if (verbose) console.log('  [' + level.id + '] $ ' + cmd + '\n' + r.out.split('\n').map((l) => '      ' + l).join('\n'));
      if (/模擬器內部錯誤/.test(r.out)) { fail++; console.log('✗ ' + level.id + ' 內部錯誤：' + cmd + '\n' + r.out); }
    }
    G.advance(level, w);
    if (w.step <= i) { fail++; ok = false; console.log('✗ ' + level.id + ' 步驟 ' + (i + 1) + ' 執行解答後仍未通過：' + level.steps[i].text.split('\n')[0]); break; }
  }
  if (ok && w.step === level.steps.length) console.log('✓ ' + level.id + ' ' + level.title + '（' + level.steps.length + ' 步）');
}
console.log(fail ? '\n有 ' + fail + ' 個問題' : '\n全部關卡都可破關');
process.exit(fail ? 1 : 0);
