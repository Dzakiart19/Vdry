# Install Firebase CLI (sekali saja)
npm install -g firebase-tools

# Login ke akun Google
firebase login --no-localhost

# Masuk ke folder project (download dari Replit atau clone dari GitHub)
cd path/ke/folder/vidorey

# Deploy ke Firebase Hosting
firebase deploy --only hosting