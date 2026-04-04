importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// A configuração precisa estar completa também no arquivo de segundo plano
firebase.initializeApp({
  apiKey: "AIzaSyC63gBQ7JdRTnNCpSpir1brYH754fcKq9M",
  authDomain: "csc-live-bh.firebaseapp.com",
  projectId: "csc-live-bh",
  storageBucket: "csc-live-bh.firebasestorage.app",
  messagingSenderId: "345272283586",
  appId: "1:345272283586:web:648c1fb52622792406665b"
});

const messaging = firebase.messaging();

// O que fazer quando chegar notificação e o app estiver no bolso/segundo plano
messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Notificação recebida em background.', payload);
    
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/public/img/REDONDOSIMBOLO 01.png'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
