import numpy as np
import matplotlib.pyplot as plt

# Create data
x = np.linspace(0, 10, 200)
y = np.sin(x)          # calculation
z = np.cos(x) * 2      # another calculation

print("Max of sin(x):", y.max())
print("Min of sin(x):", y.min())

# Plot
plt.plot(x, y, label="sin(x)")
plt.plot(x, z, label="2 * cos(x)")

plt.title("Plot of sin(x) and 2*cos(x)")
plt.xlabel("x")
plt.ylabel("y")
plt.legend()
plt.grid(True)

plt.show()


