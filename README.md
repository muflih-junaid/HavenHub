# HavenHub – Disaster Response and Resource Coordination Platform

HavenHub is a web-based disaster response and resource coordination platform
The project aims to provide a centralized platform for reporting disaster incidents, managing assistance requests, and coordinating response activities.

## Technology Stack

- **Frontend:** React, Vite
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Authentication:** JSON Web Tokens (JWT)

## Prerequisites

Make sure the following software is installed on your machine:

- [Node.js](https://nodejs.org/) version **22 or later**
- npm (included with Node.js)
- MongoDB instance (local installation or MongoDB Atlas)
- Git

## Project Setup

7. Setup Steps

Follow these steps to run the project locally:

### Step 1 : Install Node.js

Use Node.js version 22 or later as required by the project.

### Step 2: Install dependencies

Open two terminals (Terminal 1 for server, Terminal 2 for client):

```bash
cd client && npm install
cd server && npm install
```

### Step 3: Set up environment files

Create a Client Environment file `.env`:

```env
VITE_API_URL=http://localhost:5000/api
```

For the server, copy `.env.example` to `.env` and set `MONGODB_URI` and `JWT_SECRET`.

Generate a JWT secret using:

```bash
openssl rand -hex 32
```

### Step 4 & 5: Start Backend and Frontend

In the server terminal, run:

```bash
npm run dev
```

The backend server will run at:

```text
http://localhost:5000
```

In the client terminal, run:

```bash
npm run dev
```

The frontend app will run at:

```text
http://localhost:5173
```

## Running the Application

Make sure all the required services are running:

| Component    | Address                                             |
| ------------ | --------------------------------------------------- |
| Frontend     | http://localhost:5173                               |
| Backend      | http://localhost:5000                               |
| API Base URL | http://localhost:5000/api                           |
| Database     | MongoDB connection configured through `MONGODB_URI` |

## Troubleshooting

- **Backend connection error:** Ensure the backend server is running and the `VITE_API_URL` is configured correctly.
- **Database connection error:** Verify the `MONGODB_URI` in the server environment file.
- **Authentication issues:** Ensure that a valid `JWT_SECRET` is configured.
- **Dependency errors:** Try removing `node_modules` and reinstalling dependencies using `npm install`.

## Project Information

**Project Name:** HavenHub – Disaster Response and Resource Coordination Platform

**Module:** EC4307 – Web Application Development

**Academic Year:** 2026

**Registration Number:** EG/2023/5672

---

_Developed as an academic project for the EC4307 Web Application Development module._
