importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// A configuração precisa estar completa
firebase.initializeApp({
  apiKey: "AIzaSyC63gBQ7JdRTnNCpSpir1brYH754fcKq9M",
  authDomain: "csc-live-bh.firebaseapp.com",
  projectId: "csc-live-bh",
  storageBucket: "csc-live-bh.firebasestorage.app",
  messagingSenderId: "345272283586",
  appId: "1:345272283586:web:648c1fb52622792406665b"
});

const messaging = firebase.messaging();

// Deixamos este bloco vazio propositalmente.
// Como o servidor envia um payload de "notification", o próprio FCM (Firebase) 
// se encarrega de exibir o push na tela automaticamente no iOS e Android.
// Se colocarmos código de exibição aqui, a notificação sai duplicada!
messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Mensagem recebida. O FCM cuidará da exibição.', payload);
});
