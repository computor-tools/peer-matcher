import { WebSocketServer } from 'ws';

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2, 
}

export const delayQueue = (A, B) => {
  return {
    schedule(f, g) {
      const t = setTimeout(f, Math.floor(Math.random() * (B - A + 1)) + A)
      return function cancel () {
        clearTimeout(t)
        g();
      };
    },
  }
}

export const server = function () {
  let cons = 0;
  let rejects = 0;
  const queue = delayQueue(0, 1000);
  const buffer = [];
  const wss = new WebSocketServer({
    port: 8080,
  });

  const match = function (a) {
    return new Promise(function (resolve, reject) {
      const coinToss = Math.random();
      if (coinToss > 1 / 2) {
        a.resolve = resolve;
        a.reject = reject;
        buffer.push(a);
      } else {
        a.deschedule = queue.schedule(
          function () {
            if (!a.closed) {
              while (buffer.length > 0) {
                const i = Math.floor(Math.random() * (buffer.length + 1));
                let b = buffer[i];
                if (b !== undefined) {
                  buffer.splice(i, 1);
                  if (b.closed === true) {
                    b.reject();
                  } /*if (b.remoteAddress !== a.remoteAddress)*/ else {
                    // Assign roles
                    a.role = 1; // Caller makes SDP offer
                    b.role = 0; // Callee answers SDP offer
                    a.peer = b;
                    b.peer = a;
                    resolve();
                    b.resolve();
                    return;
                  }
                }
              }
              a.resolve = resolve;
              a.reject = reject;
              buffer.push(a);
            }
          },
          reject
        );
      }
    });
  }


  function heartbeat(socket) {
    socket.isAlive = true;
  }
  
  const interval = setInterval(function ping() {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        rejects++;
        return socket.terminate();
      }
  
      socket.isAlive = false;
    }
  }, 1100);
  
  wss.on('close', function close() {
    clearInterval(interval);
  });

  wss.on('connection', function connection(socket, req) {
    socket.remoteAddress = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(/\s*,\s*/)[0]
      : req.socket.remoteAddress;

    heartbeat(socket);

    const promise = match(socket);

    promise
      .then(function () {
        const signal = new Uint8Array(2);
        signal[0] = SIGNAL_TYPES.ROLE;
        signal[1] = socket.role;
        socket.send(signal);
      })
      .catch(function () {
        rejects++;
        socket.close();
      });

    socket.on('message', function message(signal) {
      const type = signal[0];
      if (signal[0] === SIGNAL_TYPES.ICE_CANDIDATE || signal[0] === SIGNAL_TYPES.SESSION_DESCRIPTION) {
          promise.then(function () {
            socket.peer.send(signal);
          })
          heartbeat(socket)
          if (signal[0] === SIGNAL_TYPES.SESSION_DESCRIPTION) {
            cons++;
          }
      } else {
        socket.close();
      }
    });

    socket.on('close', function close() {
      socket.closed = true;
      let i = buffer.indexOf(socket);
      if (i > -1) {
        buffer.splice(i, 1);
      }
      if (typeof socket.deschedule === 'function') {
        socket.deschedule(); // if needed
      }
    });
  });

  let cons2 = 0;
  let rejects2 = 0;
  setInterval(function () {
    console.log('+' + (cons - cons2), -(rejects - rejects2), buffer.length);
    cons2 = cons;
    rejects2 = rejects; 
  }, 2000);
}

server();