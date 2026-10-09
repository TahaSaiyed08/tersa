import java.util.*;
import java.util.stream.*;

public class Main {
    sealed interface Tree<T extends Comparable<T>> permits Leaf, Node {}
    record Leaf<T extends Comparable<T>>() implements Tree<T> {}
    record Node<T extends Comparable<T>>(Tree<T> left, T value, Tree<T> right) implements Tree<T> {}

    static <T extends Comparable<T>> Tree<T> insert(Tree<T> t, T v) {
        return switch (t) {
            case Leaf<T> l -> new Node<>(new Leaf<>(), v, new Leaf<>());
            case Node<T> n -> {
                int c = v.compareTo(n.value());
                if (c < 0) yield new Node<>(insert(n.left(), v), n.value(), n.right());
                if (c > 0) yield new Node<>(n.left(), n.value(), insert(n.right(), v));
                yield n;
            }
        };
    }

    static <T extends Comparable<T>> List<T> toList(Tree<T> t) {
        return switch (t) {
            case Leaf<T> l -> new ArrayList<>();
            case Node<T> n -> {
                List<T> out = toList(n.left());
                out.add(n.value());
                out.addAll(toList(n.right()));
                yield out;
            }
        };
    }

    static <T extends Comparable<T>> int height(Tree<T> t) {
        return switch (t) {
            case Leaf<T> l -> 0;
            case Node<T> n -> 1 + Math.max(height(n.left()), height(n.right()));
        };
    }

    static <T extends Comparable<T>> boolean contains(Tree<T> t, T v) {
        return switch (t) {
            case Leaf<T> l -> false;
            case Node<T> n -> {
                int c = v.compareTo(n.value());
                if (c == 0) yield true;
                yield c < 0 ? contains(n.left(), v) : contains(n.right(), v);
            }
        };
    }

    public static void main(String[] args) {
        Tree<Integer> t = new Leaf<>();
        for (int v : new int[] {50, 30, 70, 20, 40, 60, 80, 30}) {
            t = insert(t, v);
        }
        System.out.println(toList(t).stream().map(String::valueOf).collect(Collectors.joining(" ")));
        System.out.println("height: " + height(t) + ", has 60: " + contains(t, 60) + ", has 65: " + contains(t, 65));
        Tree<String> words = new Leaf<>();
        for (String w : "pear apple fig".split(" ")) {
            words = insert(words, w);
        }
        System.out.println(String.join(" ", toList(words)));
    }
}
