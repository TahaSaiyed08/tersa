import java.util.*;

public class Main {
    record Sale(String region, String product, int units, double price) {}

    static Sale parseLine(String line, int n) {
        String[] cols = line.split(",");
        if (cols.length != 4) {
            throw new IllegalArgumentException("line " + n + ": expected 4 columns, got " + cols.length);
        }
        int units;
        double price;
        try {
            units = Integer.parseInt(cols[2].trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("line " + n + ": bad units '" + cols[2] + "'");
        }
        try {
            price = Double.parseDouble(cols[3].trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("line " + n + ": bad price '" + cols[3] + "'");
        }
        return new Sale(cols[0].trim(), cols[1].trim(), units, price);
    }

    public static void main(String[] args) {
        String data = """
            region,product,units,price
            west,widget,10,2.50
            east,gadget,3,10.00
            west,gadget,oops,10.00
            east,widget,7,2.50
            north,widget,1
            west,widget,5,2.50""";

        List<Sale> sales = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        String[] lines = data.split("\n");
        for (int i = 1; i < lines.length; i++) {
            try {
                sales.add(parseLine(lines[i], i + 1));
            } catch (IllegalArgumentException e) {
                errors.add(e.getMessage());
            }
        }

        Map<String, List<Sale>> byRegion = new TreeMap<>();
        for (Sale s : sales) {
            byRegion.computeIfAbsent(s.region(), k -> new ArrayList<>()).add(s);
        }
        for (var entry : byRegion.entrySet()) {
            List<Sale> rows = entry.getValue();
            double revenue = rows.stream().mapToDouble(s -> s.units() * s.price()).sum();
            System.out.printf("%s: %d sales, revenue %.2f%n", entry.getKey(), rows.size(), revenue);
        }
        System.out.println("skipped " + errors.size() + " bad lines:");
        for (String e : errors) {
            System.out.println("  " + e);
        }
    }
}
