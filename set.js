const fs = require('fs');
fs.writeFileSync('keys.js', `const KEYS = {
    SUPABASE_URL: '${process.env.SUPABASE_URL}',
    SUPABASE_KEY: '${process.env.SUPABASE_KEY}'
};`);