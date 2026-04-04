importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// O Firebase precisa dessa inicialização vazia no Service Worker
firebase.initializeApp({
    projectId: "csc-live-bh" // O nome do projeto que você criou
});

const messaging = firebase.messaging();

// O que fazer quando chegar notificação e o app estiver em segundo plano
messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Notificação recebida em background.', payload);
    
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/public/img/REDONDOSIMBOLO 01.png'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
