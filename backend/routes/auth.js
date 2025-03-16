const express = require("express");
const pool = require("../config/db");
const bcrypt = require("bcryptjs");

const router = express.Router();

// 🔹 Signup Route ✅
router.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;

    console.log("Signup Request:", req.body);

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
            [name, email, hashedPassword]
        );

        console.log("User Created:", newUser.rows[0]);
        res.json(newUser.rows[0]);
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 🔹 Login Route ✅
router.post("/login", async (req, res) => {
    console.log("Received Login Request:", req.body);

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (user.rows.length === 0) {
            return res.status(401).json({ message: "User not found" });
        }

        const storedHashedPassword = user.rows[0].password;
        const isMatch = await bcrypt.compare(password, storedHashedPassword);

        if (!isMatch) {
            return res.status(401).json({ message: "Incorrect password" });
        }

        // For simplicity, return user data without JWT
        res.json({ message: "Login successful", user: user.rows[0] });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
