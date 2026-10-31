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

Follow these steps to run the project locally.

### Step 1: Install Node.js

Install Node.js version **22 or later**, as required by the project.

Verify your installation:

```bash
node --version
npm --version
```

### Step 2: Install Dependencies

Open two separate terminals:

- **Terminal 1:** Backend (Server)
- **Terminal 2:** Frontend (Client)

In Terminal 1, navigate to the server directory and install the dependencies:

```bash
cd server
npm install
```

In Terminal 2, navigate to the client directory and install the dependencies:

```bash
cd client
npm install
```

### Step 3: Configure Environment Variables

The project requires environment variables for the frontend and backend.

**Frontend Configuration**

Create a `.env` file inside the `client` directory:

```env
VITE_API_URL=http://localhost:5000/api
```

**Backend Configuration**

Inside the `server` directory, copy the example environment file:

```bash
cp .env.example .env
```

Open the newly created `server/.env` file and configure the following variables:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_generated_jwt_secret
```

Replace the MongoDB URI with your actual MongoDB connection string.

Generate a secure JWT secret using:

```bash
openssl rand -hex 32
```

Copy the generated value into the `JWT_SECRET` variable.

**Important:** Do not commit your `.env` files or expose your database credentials and JWT secret in the GitHub repository.

### Step 4: Start the Backend Server

In Terminal 1, from the `server` directory, execute:

```bash
npm run dev
```

The backend server should be available at:

```text
http://localhost:5000
```

### Step 5: Start the Frontend Application

In Terminal 2, from the `client` directory, execute:

```bash
npm run dev
```

Vite will display the local development URL in the terminal. Open that URL in your browser to access HavenHub.

The default Vite development URL is:

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
