# Admin Booking Management System

A mobile-first admin panel to manage cabin bookings.

## Features

- 📱 **Mobile-first design** - Optimized for mobile and tablet views
- 📅 **View all bookings** - See all reservations at a glance
- ➕ **Add new bookings** - Create reservations with real-time price calculation
- 🗑️ **Delete bookings** - Remove reservations when needed
- 💰 **Automatic pricing** - Price calculated based on cabin type and number of people
- 🔒 **Real-time availability** - See which cabins are available

## Getting Started

### Install Dependencies

```bash
npm install
```

### Start the Admin Panel

```bash
npm run admin
```

The admin panel will be available at `http://localhost:3000`

## Usage

### View Bookings Tab
- See all current bookings
- View booking details (cabin, phone, time, people, price)
- Delete bookings with one click

### Add New Booking Tab
- Enter phone number
- Select date and time
- Choose cabin (1-4)
- Enter number of people
- Price is calculated automatically
- Create booking

## API Endpoints

- `GET /api/bookings` - Get all bookings
- `GET /api/slots/:date` - Get available time slots for a date
- `POST /api/bookings` - Create a new booking
- `DELETE /api/bookings/:id?phone=xxx` - Delete a booking
- `GET /api/config` - Get system configuration

## Price Calculation

- Single person (1 person): Base price (₸2000)
- Multiple people: Base price + (number of people - 1) × per-person rate (₸1300)

Example:
- 1 person: ₸2000
- 2 people: ₸2000 + ₸1300 = ₸3300
- 4 people: ₸2000 + ₸3900 = ₸5900
