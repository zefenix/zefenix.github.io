// A long book of the tests' own, saved in the browser as the bookmarklet saves a page, so a book in parts can be tried.
// 30 chapters of about 9,000 characters each come to four parts. "lantern" appears in every chapter.
const { loaded } = require('./common');
module.exports = async function longBook(p) {
  await p.goto('http://pp.test/pages-piled/');
  await loaded(p);
  return p.evaluate(async () => {
    const words = ['river', 'stone', 'window', 'harbour', 'letter', 'garden', 'engine', 'bridge', 'candle', 'market'];
    const chapters = Array.from({ length: 30 }, (_, c) => {
      const paras = Array.from({ length: 40 }, (_, i) => `In chapter ${c + 1} the ${words[(c + i) % 10]} stood by the lantern for a while. Paragraph ${i + 1} goes on about the ${words[(c * 3 + i) % 10]}, and then about the weather, which was mild. Nothing else happened that day, and nobody minded at all.`);
      return { title: `Chapter ${c + 1}`, url: `file:///long-test-book/chapter-${c + 1}.md`, markdown: `# Chapter ${c + 1}\n\n${paras.join('\n\n')}` };
    });
    return window.bookTools.saveBook({ v: 1, title: 'A long test book', site: 'your files', url: 'file:///long-test-book', from: 'files', at: new Date().toISOString(), chapters });
  });
};
