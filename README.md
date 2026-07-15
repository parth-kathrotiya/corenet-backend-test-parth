# BookSlot Backend (NestJS & Prisma)

BookSlot is a simple appointment booking platform backend built with **NestJS**, **Prisma ORM**, and **PostgreSQL**.

---

## Prerequisites

Ensure you have the following installed on your machine:
*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   [npm](https://www.npmjs.com/) (comes with Node.js)

---

## 1. Database Setup

Make sure your PostgreSQL server is running at `localhost:5432` with a database named `slotbooking`.

---

## 2. Environment Configuration

Create a `.env` file inside the `backend` directory.

```bash
# e:\Projects\corenet-backend-test-parth\backend\.env

PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/slotbooking?schema=public"
JWT_SECRET="super-secret-jwt-signing-key-for-bookslot"
JWT_EXPIRATION="24h"
```

An `.env.example` file is also provided in the `backend` directory for reference.

---

## 3. Project Installation & Setup

1.  Navigate into the `backend` directory:
    ```bash
    cd backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run database migrations to generate and sync tables:
    ```bash
    npx prisma migrate dev --name init
    ```
4.  (Optional) Generate Prisma Client code if it did not auto-generate:
    ```bash
    npx prisma generate
    ```

---

## 4. Running the Application

To run the application locally in development mode:

```bash
# Make sure you are inside the backend directory
npm run start:dev
```

The server will start at `http://localhost:3000/`. You can view the API documentation or start sending requests.

---

## 5. Running Tests

To run unit tests:

```bash
# Make sure you are inside the backend directory
npm run test
```

Unit tests mock the Prisma database client using Jest mock utilities, ensuring they run fast and without requiring a live database connection.
