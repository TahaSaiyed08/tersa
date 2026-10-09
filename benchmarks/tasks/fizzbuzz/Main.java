public class Main {
    static String fizzbuzz(int n) {
        if (n % 15 == 0) return "FizzBuzz";
        if (n % 3 == 0) return "Fizz";
        if (n % 5 == 0) return "Buzz";
        return String.valueOf(n);
    }

    public static void main(String[] args) {
        for (int i = 1; i <= 15; i++) {
            System.out.println(fizzbuzz(i));
        }
    }
}
