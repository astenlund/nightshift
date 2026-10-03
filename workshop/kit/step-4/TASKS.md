# Tasks

Handed over: no

Work through the tasks in order. When a task is done, change its `- [ ]` to `- [x]`.
If a task needs a decision from the user, change its `- [ ]` to `- [?]`, add your question to the end of that line, and carry on with the other tasks.

- [ ] Add `slugify(text)` to `src/text.js`: lowercase, every run of spaces or punctuation becomes one hyphen, no hyphen at either end ("Hello, World!" becomes "hello-world").
- [ ] Add `titleCase(text)` to `src/text.js`: capitalise the first letter of every word ("the quick fox" becomes "The Quick Fox").
- [ ] Add `test/text.test.js` with `node:test` tests for `wordCount`, `slugify` and `titleCase`, and make `node --test` pass.
- [ ] Get the product owner's sign-off on the slug format. Only the user can arrange this.
