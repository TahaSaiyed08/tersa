import java.util.*;

public class Main {
    static class Task {
        final int id;
        final String title;
        boolean done = false;
        final List<String> tags;

        Task(int id, String title, List<String> tags) {
            this.id = id;
            this.title = title;
            this.tags = tags;
        }
    }

    static List<Task> tasks = new ArrayList<>();
    static int nextId = 1;

    static Task add(String title, List<String> tags) {
        Task t = new Task(nextId++, title, tags);
        tasks.add(t);
        return t;
    }

    static void complete(int id) {
        Task t = tasks.stream().filter(x -> x.id == id).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("no task #" + id));
        if (t.done) throw new IllegalArgumentException("task #" + id + " is already done");
        t.done = true;
    }

    public static void main(String[] args) {
        add("write spec", List.of("docs"));
        add("build compiler", List.of("code"));
        add("publish to npm", List.of("release", "code"));
        complete(2);
        for (int id : new int[] {2, 9}) {
            try {
                complete(id);
                System.out.println("ok");
            } catch (IllegalArgumentException e) {
                System.out.println("error: " + e.getMessage());
            }
        }

        for (Task t : tasks) {
            String mark = t.done ? "x" : " ";
            System.out.println("[" + mark + "] #" + t.id + " " + t.title + " (" + String.join(", ", t.tags) + ")");
        }
        long codeLeft = tasks.stream().filter(t -> !t.done && t.tags.contains("code")).count();
        long done = tasks.stream().filter(t -> t.done).count();
        System.out.println(done + "/" + tasks.size() + " done, " + codeLeft + " code task(s) left");
    }
}
