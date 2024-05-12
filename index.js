// index.js
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const crypto = require('crypto');

const app = express();
const port = 3000;

// MySQL Connection
const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '',
  database: 'food'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL: ' + err.stack);
    return;
  }
  console.log('Connected to MySQL as id ' + connection.threadId);
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
// Route for rider login

app.post('/login/rider', (req, res) => {
    const { phone, password } = req.body;
    console.log(req.body)
    // Check if phone and password are provided
    if (!phone || !password) {
      return res.status(400).json({ message: "Phone number and password are required" });
    }
  
    // Query the database to find the rider with the provided phone number
    const query = "SELECT * FROM Riders WHERE phone = ?";
    connection.query(query, [phone], (err, results) => {
      if (err) {
        console.error("Error querying database:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
  
      // Check if rider with the provided phone number exists
      if (results.length === 0) {
        return res.status(404).json({ message: "Rider not found" });
      }
  
      const rider = results[0];
  
      // Check if the password matches
      if (password !== rider.password) {
        return res.status(401).json({ message: "Invalid password" });
      }
  
      // Generate session token
      const sessionToken = crypto.randomBytes(64).toString('hex');
  
      // Update tokenSession column in the Riders table
      const updateQuery = "UPDATE Riders SET tokenSession = ? WHERE id = ?";
      connection.query(updateQuery, [sessionToken, rider.id], (err, result) => {
        if (err) {
          console.error("Error updating tokenSession:", err);
          return res.status(500).json({ message: "Internal server error" });
        }
  
        // Login successful
        return res.status(200).json({ message: "Login successful", sessionToken });
      });
    });
  });

// Define your routes here

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
