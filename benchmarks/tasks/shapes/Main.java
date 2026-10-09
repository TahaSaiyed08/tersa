import java.util.*;

public class Main {
    sealed interface Shape permits Circle, Rect, Triangle {}
    record Circle(double r) implements Shape {}
    record Rect(double w, double h) implements Shape {}
    record Triangle(double a, double b, double c) implements Shape {}

    static String name(Shape s) {
        return switch (s) {
            case Circle c -> "circle";
            case Rect r -> "rect";
            case Triangle t -> "triangle";
        };
    }

    static double area(Shape s) {
        return switch (s) {
            case Circle c -> Math.PI * c.r() * c.r();
            case Rect r -> r.w() * r.h();
            case Triangle t -> {
                double p = (t.a() + t.b() + t.c()) / 2;
                yield Math.sqrt(p * (p - t.a()) * (p - t.b()) * (p - t.c()));
            }
        };
    }

    static double perimeter(Shape s) {
        return switch (s) {
            case Circle c -> 2 * Math.PI * c.r();
            case Rect r -> 2 * (r.w() + r.h());
            case Triangle t -> t.a() + t.b() + t.c();
        };
    }

    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(1.0), new Rect(3.0, 4.0), new Triangle(3.0, 4.0, 5.0));
        for (Shape s : shapes) {
            System.out.printf("%s: area=%.2f perimeter=%.2f%n", name(s), area(s), perimeter(s));
        }
        Shape largest = Collections.max(shapes, Comparator.comparingDouble(Main::area));
        System.out.println("largest: " + name(largest));
        System.out.printf("total area: %.2f%n", shapes.stream().mapToDouble(Main::area).sum());
    }
}
