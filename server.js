require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ---------------- AUTH ----------------
app.post('/api/register', async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10);

  await supabase.from('users').insert([{
    email: req.body.email,
    password: hash
  }]);

  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('email', req.body.email)
    .single();

  const ok = await bcrypt.compare(req.body.password, data.password);
  if (!ok) return res.status(400).send("Wrong password");

  const token = jwt.sign({ id: data.id }, process.env.JWT_SECRET);
  res.json({ token });
});

function auth(req, res, next) {
  try {
    const token = req.headers.authorization;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).send("Unauthorized");
  }
}

// ---------------- BOTS ----------------
const BOTS = {
  standard: { price: 5, xp: 100 },
  bronze: { price: 15, xp: 250 },
  silver: { price: 25, xp: 400 },
  gold: { price: 50, xp: 650 },
  premium: { price: 100, xp: 1000 },
  community1: { price: 300, xp: 2500 },
  community2: { price: 500, xp: 5000 }
};

// ---------------- INIT PAYMENT ----------------
app.post('/api/pay', auth, async (req, res) => {
  const bot = BOTS[req.body.type];

  const response = await axios.post(
    "https://api.flutterwave.com/v3/payments",
    {
      tx_ref: Date.now().toString(),
      amount: bot.price,
      currency: "USD",
      redirect_url: process.env.CLIENT_URL + "/success",
      customer: {
        email: "user@email.com"
      },
      customizations: {
        title: "NeuralMine Bot Purchase"
      },
      meta: {
        userId: req.userId,
        type: req.body.type,
        xp: bot.xp
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET}`,
        "Content-Type": "application/json"
      }
    }
  );

  res.json({ link: response.data.data.link });
});

// ---------------- VERIFY PAYMENT ----------------
app.get('/api/verify', async (req, res) => {
  const tx_id = req.query.transaction_id;

  const response = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${tx_id}/verify`,
    {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET}`
      }
    }
  );

  const data = response.data.data;

  if (data.status === "successful") {
    const meta = data.meta;

    await supabase.from('bots').insert([{
      user_id: meta.userId,
      type: meta.type,
      xp: meta.xp
    }]);
  }

  res.redirect(process.env.CLIENT_URL);
});

// ---------------- DASHBOARD ----------------
app.get('/api/dashboard', auth, async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.userId)
    .single();

  res.json(data);
});

// ---------------- WITHDRAW ----------------
app.post('/api/withdraw', auth, async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.userId)
    .single();

  const amount = data.xp * 0.01;

  await supabase.from('withdrawals').insert([{
    user_id: req.userId,
    amount
  }]);

  await supabase.from('users')
    .update({ xp: 0 })
    .eq('id', req.userId);

  res.json({ ok: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));