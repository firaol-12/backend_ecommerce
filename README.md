# Ecommerce Backend API

This project is a Node.js + Express + PostgreSQL backend built around the included `schema.sql` database.

## Features

- User authentication and profile management
- Customer cart and wishlist
- Product catalog with category support
- Order checkout and tracking
- Payment recording
- Product reviews
- Coupon validation
- Admin dashboard and user management
- Address management

## Setup

1. Copy `.env.example` to `.env`
2. Update your PostgreSQL connection string in `.env`
3. Create the schema in PostgreSQL using `schema.sql`
4. Run the app:

   ```bash
   npm install
   npm run dev
   ```

## Base URL

```text
http://localhost:5000/api
```

## Important routes

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Users

- `GET /api/users/profile`
- `PUT /api/users/profile`
- `GET /api/users` (admin)
- `GET /api/users/:id` (admin)
- `PATCH /api/users/:id/status` (admin)

### Categories

- `GET /api/categories`
- `GET /api/categories/:id`
- `POST /api/categories` (admin)
- `PUT /api/categories/:id` (admin)
- `DELETE /api/categories/:id` (admin)

### Products

- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/products/slug/:slug`
- `POST /api/products` (admin)
- `PUT /api/products/:id` (admin)
- `DELETE /api/products/:id` (admin)
- `POST /api/products/:id/images` (admin)

### Cart and wishlist

- `GET /api/cart`
- `POST /api/cart`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id`
- `GET /api/wishlist`
- `POST /api/wishlist`
- `DELETE /api/wishlist/:productId`

### Orders and payments

- `POST /api/orders/checkout`
- `GET /api/orders/my`
- `GET /api/orders/:id`
- `GET /api/orders` (admin)
- `PATCH /api/orders/:id/status` (admin)
- `GET /api/payments/order/:orderId`
- `POST /api/payments/order/:orderId`

### Reviews

- `GET /api/reviews/product/:productId`
- `POST /api/reviews/product/:productId`
- `PUT /api/reviews/:id`
- `GET /api/reviews/my`

### Addresses

- `GET /api/addresses`
- `POST /api/addresses`
- `PUT /api/addresses/:id`
- `DELETE /api/addresses/:id`

### Coupons

- `GET /api/coupons` (admin)
- `POST /api/coupons/validate`
- `POST /api/coupons` (admin)

### Admin

- `GET /api/admin/dashboard`

## Notes

- JWT is used for authentication.
- Admin routes require a user with `role = 'admin'`.
- The project assumes PostgreSQL is running and the `.env` connection string points to a valid database.
