const express = require('express');
const cors = require('cors');
require('dotenv').config();

const convertRoute = require('./routes/convert');
const toolsRoute = require('./routes/tools');
const bookmarksRoute = require('./routes/bookmarks');
const accountRoute = require('./routes/account');
const premiumRoute = require('./routes/premium');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/', convertRoute);
app.use('/', toolsRoute);
app.use('/', bookmarksRoute);
app.use('/', accountRoute);
app.use('/', premiumRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend flipbook démarré sur le port ${PORT}`);
});
