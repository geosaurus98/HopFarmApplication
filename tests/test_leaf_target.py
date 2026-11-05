import unittest

from tools.leaf_target import required_leaves


class RequiredLeavesTest(unittest.TestCase):
    def test_spec_examples(self):
        self.assertEqual(required_leaves(3.38), 50)    # Block H1: 33.8 -> minimum 50
        self.assertEqual(required_leaves(7.84), 75)    # Block A1: 78.4 -> 75
        self.assertEqual(required_leaves(11.77), 115)  # Block K2: 117.7 -> 115

    def test_minimum_is_fifty(self):
        for area in (0.01, 1, 4.99, 5.0, 5.49):
            self.assertEqual(required_leaves(area), 50, area)

    def test_rounds_down_to_multiple_of_five(self):
        self.assertEqual(required_leaves(5.5), 55)
        self.assertEqual(required_leaves(5.99), 55)
        self.assertEqual(required_leaves(6.0), 60)
        self.assertEqual(required_leaves(20.0), 200)

    def test_always_multiple_of_five_for_two_decimal_areas(self):
        # Guards against floating-point surprises such as 5.1 * 10 = 50.999...
        for hundredths in range(1, 5001):
            area = hundredths / 100
            got = required_leaves(area)
            self.assertEqual(got % 5, 0, area)
            self.assertGreaterEqual(got, 50)
            self.assertEqual(got, max(50, (hundredths // 50) * 5), area)

    def test_rejects_non_positive_area(self):
        for bad in (0, -1, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                required_leaves(bad)


if __name__ == "__main__":
    unittest.main()
