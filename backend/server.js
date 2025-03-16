require("dotenv").config();
const express = require("express");
const { ApolloServer, gql } = require("apollo-server-express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const { graphqlUploadExpress , GraphQLUpload} = require("graphql-upload-minimal");
const path = require("path");


const { createWriteStream } = require("fs");
const app = express();
app.use(graphqlUploadExpress({ maxFileSize: 100 * 1024 * 1024, maxFiles: 10 }));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
// Middleware
app.use(cors({ 
  origin: ["http://localhost:3000", "https://studio.apollographql.com"],
  credentials: true 
}));

app.use(cookieParser());



// Serve static files from the "uploads" directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;

// GraphQL Schema
const typeDefs = gql`
  scalar Upload

  type File {
   
    url: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
  }

  type Persona {
    id: ID!
    user_id: Int!
    name: String!
    quote: String
    description: String
    attitudes: String
    pain_points: String
    jobs_needs: String
    activities: String
    avatar_url: String
    created_at: String
    last_updated: String
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Query {
    users: [User]
    personas: [Persona]
    persona(id: ID!): Persona
    loggedInUser: User
  }

  type Mutation {
    uploadFile(file: Upload!): File!
    signup(name: String!, email: String!, password: String!): AuthPayload
    login(email: String!, password: String!): AuthPayload
    addPersona(
      user_id: Int!
      name: String!
      quote: String
      description: String
      attitudes: String
      pain_points: String
      jobs_needs: String
      activities: String
      avatar_url: String
    ): Persona
    updatePersona(
      id: ID!
      name: String
      quote: String
      description: String
      attitudes: String
      pain_points: String
      jobs_needs: String
      activities: String
      avatar_url: String
    ): Persona
    deletePersona(id: ID!): Boolean
    deleteAllPersonas: Boolean
  }
`;

// GraphQL Resolvers
const resolvers = {
  Upload: GraphQLUpload,
  Query: {
    users: async () => {
      const res = await pool.query("SELECT id, name, email FROM users");
      return res.rows;
    },
    personas: async () => {
      const res = await pool.query("SELECT * FROM persona");
      return res.rows;
    },
    persona: async (_, { id }) => {
      const res = await pool.query("SELECT * FROM persona WHERE id = $1", [id]);
      return res.rows[0];
    },
    loggedInUser: async (_, __, context) => {
      if (!context.user) throw new Error("Not authenticated");
      const res = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [context.user.id]);
      return res.rows[0];
    },
  },

  Mutation: {
    login: async (_, { email, password }) => {
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (result.rows.length === 0) throw new Error("User not found!");
      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new Error("Invalid credentials!");
      const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: "1h" });
      return { token, user };
    },

    signup: async (_, { name, email, password }) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await pool.query(
        "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email",
        [name, email, hashedPassword]
      );
      const user = result.rows[0];
      const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: "1h" });
      return { token, user };
    },
    uploadFile: async (_, { file }) => {
      console.log("Received file:", file); // Debugging
    
      const { createReadStream, filename } = await file;
      
      if (!createReadStream) {
        throw new Error("File stream could not be created");
      }
      
      console.log("Processing file:", filename);
    
      const filePath = path.join(__dirname, `uploads/${filename}`);
      return new Promise((resolve, reject) => {
        const stream = createReadStream();
        const out = createWriteStream(filePath);
    
        stream.pipe(out);
        out.on("finish", () => resolve({ url: `http://localhost:5000/uploads/${filename}` }));
        out.on("error", reject);
      });
    },    
    addPersona: async (_, args) => {
      const result = await pool.query(
        `INSERT INTO persona (
          user_id, name, quote, description, attitudes, pain_points, jobs_needs, activities, avatar_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          args.user_id,
          args.name,
          args.quote,
          args.description,
          args.attitudes,
          args.pain_points,
          args.jobs_needs,
          args.activities,
          args.avatar_url,
        ]
      );
      return result.rows[0];
    },

    updatePersona: async (_, args) => {
      const result = await pool.query(
        `UPDATE persona SET
          name = COALESCE($2, name),
          quote = COALESCE($3, quote),
          description = COALESCE($4, description),
          attitudes = COALESCE($5, attitudes),
          pain_points = COALESCE($6, pain_points),
          jobs_needs = COALESCE($7, jobs_needs),
          activities = COALESCE($8, activities),
          avatar_url = COALESCE($9, avatar_url),
          last_updated = NOW()
        WHERE id = $1 RETURNING *`,
        [
          args.id,
          args.name,
          args.quote,
          args.description,
          args.attitudes,
          args.pain_points,
          args.jobs_needs,
          args.activities,
          args.avatar_url,
        ]
      );
      console.log("Updated Persona:", result.rows[0]); // Debugging
      return result.rows[0];
    },

    deletePersona: async (_, { id }) => {
      await pool.query("DELETE FROM persona WHERE id = $1", [id]);
      return true;
    },
  },
};

// Start Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req }) => {
    const token = req.headers.authorization || "";

    if (token) {
      try {
        const decoded = jwt.verify(token.replace("Bearer ", ""), SECRET_KEY);
        return { user: decoded };
      } catch (error) {
        console.error("Invalid token:", error);
      }
    }

    return { user: null };
  },
});

async function startServer() {
  await server.start();
  server.applyMiddleware({ app, cors: false });
}

startServer();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}/graphql`));