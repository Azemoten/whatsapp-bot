import express from 'express';
import { storage } from '../storage.js';
import { buildSlots, countFreeCabinsForSlot, overlaps } from '../bookingLogic.js';
import dayjs from 'dayjs';
import crypto from 'crypto';
import { cfg } from '../utils.js';

const router = express.Router();

// Get all bookings
router.get('/bookings', (req, res) => {
  try {
    const bookings = storage.list();
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available slots for a date
router.get('/slots/:date', (req, res) => {
  try {
    const slots = buildSlots(req.params.date);
    const bookings = storage.list();
    
    const slotsWithAvailability = slots.map(slot => {
      const freeCabins = countFreeCabinsForSlot(slot, bookings);
      return {
        ...slot,
        availableCabins: freeCabins,
        isFull: freeCabins === 0
      };
    });
    
    res.json(slotsWithAvailability);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new booking
router.post('/bookings', (req, res) => {
  try {
    const { phone, cabinNumber, startISO, endISO, numberOfPeople, adults, children, totalPrice } = req.body;
    
    if (!phone || !cabinNumber || !startISO || !endISO || !numberOfPeople) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate that booking is not in the past
    const now = dayjs();
    const startTime = dayjs(startISO);
    
    if (startTime.isBefore(now)) {
      return res.status(400).json({ error: 'Booking time cannot be in the past' });
    }
    
    const bookings = storage.list();
    
    // Check for conflicts
    for (const booking of bookings) {
      if (booking.cabinNumber === cabinNumber && overlaps(startISO, endISO, booking.startISO, booking.endISO)) {
        return res.status(409).json({ error: 'Cabin already booked for this time' });
      }
    }
    
    // Use provided totalPrice or calculate it
    const finalTotalPrice = totalPrice || (numberOfPeople * cfg.pricePerPerson);
    
    const booking = {
      id: crypto.randomBytes(4).toString('hex'),
      phone,
      cabinNumber: parseInt(cabinNumber),
      startISO,
      endISO,
      numberOfPeople: parseInt(numberOfPeople),
      adults: adults || 0,
      children: children || 0,
      totalPrice: finalTotalPrice,
      status: 'pending',
      createdAtISO: dayjs().toISOString()
    };
    
    storage.add(booking);
    res.status(201).json(booking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update booking status
router.patch('/bookings/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status || !['pending', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "pending" or "paid"' });
    }
    
    const booking = storage.updateStatus(id, status);
    
    if (booking) {
      res.json(booking);
    } else {
      res.status(404).json({ error: 'Booking not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete booking
router.delete('/bookings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { phone } = req.query;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const removed = storage.removeById(id, phone);
    
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Booking not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get config
router.get('/config', (req, res) => {
  try {
    res.json(cfg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
