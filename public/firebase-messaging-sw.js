importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// A configuração precisa estar completa para o Service Worker conectar na nuvem
firebase.initializeApp({
  apiKey: "AIzaSyC63gBQ7JdRTnNCpSpir1brYH754fcKq9M",
  authDomain: "csc-live-bh.firebaseapp.com",
  projectId: "csc-live-bh",
  storageBucket: "csc-live-bh.firebasestorage.app",
  messagingSenderId: "345272283586",
  appId: "1:345272283586:web:648c1fb52622792406665b"
});

const messaging = firebase.messaging();

// IMPORTANTE: 
// Removemos completamente o "onBackgroundMessage" daqui!
// Se você não interceptar a mensagem, o sistema nativo do Firebase (FCM)
// assume o controle absoluto e garante que a notificação apareça na tela
// do iOS e do Android de forma limpa, sem duplicar e sem falhar.
