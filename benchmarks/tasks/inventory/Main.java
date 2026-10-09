import java.util.*;
import java.util.stream.*;

public class Main {
    static class Item {
        final String name;
        int qty;
        final int minQty;
        final double price;

        Item(String name, int qty, int minQty, double price) {
            this.name = name;
            this.qty = qty;
            this.minQty = minQty;
            this.price = price;
        }
    }

    static Map<String, Item> stock = new LinkedHashMap<>();

    static void sell(String name, int n) {
        Item item = stock.get(name);
        if (item == null) throw new IllegalArgumentException("unknown item " + name);
        if (item.qty < n) throw new IllegalArgumentException("only " + item.qty + " " + name + " left");
        item.qty -= n;
    }

    public static void main(String[] args) {
        for (Item it : List.of(new Item("apple", 50, 20, 0.5), new Item("bread", 5, 10, 2.25),
                new Item("milk", 8, 12, 1.2), new Item("rice", 30, 5, 3.0))) {
            stock.put(it.name, it);
        }

        String[] names = {"apple", "milk", "tea", "bread"};
        int[] amounts = {35, 10, 1, 2};
        for (int i = 0; i < names.length; i++) {
            try {
                sell(names[i], amounts[i]);
                System.out.println("sold " + amounts[i] + " " + names[i]);
            } catch (IllegalArgumentException e) {
                System.out.println("cannot sell: " + e.getMessage());
            }
        }

        String low = stock.values().stream()
            .filter(i -> i.qty < i.minQty)
            .sorted(Comparator.comparingInt(i -> i.qty))
            .map(i -> i.name)
            .collect(Collectors.joining(", "));
        System.out.println("restock: " + low);
        double value = stock.values().stream().mapToDouble(i -> i.qty * i.price).sum();
        System.out.printf("stock value: %.2f%n", value);
    }
}
