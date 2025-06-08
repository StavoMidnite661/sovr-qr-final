const express = require('express');
const app = express();
const presentmentRouter = require('./api/presentment-router'); // Adjust path if needed

// Mount the presentment router at /api/presentment-router
app.use('/api/presentment-router', presentmentRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
