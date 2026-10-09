interface Task {
  id: number;
  title: string;
  done: boolean;
  tags: string[];
}

const tasks: Task[] = [];
let nextId = 1;

function add(title: string, tags: string[] = []): Task {
  const t: Task = { id: nextId++, title, done: false, tags };
  tasks.push(t);
  return t;
}

function complete(id: number): void {
  const t = tasks.find((t) => t.id === id);
  if (t === undefined) throw new Error(`no task #${id}`);
  if (t.done) throw new Error(`task #${id} is already done`);
  t.done = true;
}

add("write spec", ["docs"]);
add("build compiler", ["code"]);
add("publish to npm", ["release", "code"]);
complete(2);
for (const id of [2, 9]) {
  try {
    complete(id);
    console.log("ok");
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
  }
}

for (const t of tasks) {
  const mark = t.done ? "x" : " ";
  console.log(`[${mark}] #${t.id} ${t.title} (${t.tags.join(", ")})`);
}
const codeLeft = tasks.filter((t) => !t.done && t.tags.includes("code")).length;
console.log(`${tasks.filter((t) => t.done).length}/${tasks.length} done, ${codeLeft} code task(s) left`);
