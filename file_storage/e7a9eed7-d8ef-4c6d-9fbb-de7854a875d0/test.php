<?php
// Basic greeting
echo "Hello from PHP!<br>";

// Read a value from URL like ?name=Shagor
$name = $_GET['name'] ?? 'Guest';

// Display it
echo "Welcome, $name!";
?>
