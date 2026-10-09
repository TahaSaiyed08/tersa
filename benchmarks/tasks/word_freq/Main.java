import java.util.*;

public class Main {
    public static void main(String[] args) {
        String text = """
            the quick brown fox jumps over the lazy dog
            the dog barks and the fox runs away quick""";

        Map<String, Integer> counts = new HashMap<>();
        for (String word : text.toLowerCase().split("\\s+")) {
            counts.merge(word, 1, Integer::sum);
        }

        List<Map.Entry<String, Integer>> top = counts.entrySet().stream()
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed()
                .thenComparing(Map.Entry.comparingByKey()))
            .limit(3)
            .toList();
        for (var e : top) {
            System.out.println(e.getKey() + ": " + e.getValue());
        }
        System.out.println("unique words: " + counts.size());
    }
}
