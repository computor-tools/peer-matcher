import WebSocket from "ws";
import wrtc from 'wrtc';

const NUMBER_OF_CONNECTIONS = 10;
// change accordingly
const SIGNALING_SERVER = 'localhost:8082';
const ICE_SERVER = 'stun:0.0.0.0:3478';

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3, 
}

const channel = function ({ iceServers }, i) {
  let pc
  const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;
  const socket = new WebSocket(`ws://${SIGNALING_SERVER}`);

  socket.binaryType = 'arraybuffer';

  const timeout = setTimeout(function () {
    socket.close();
    if (pc !== undefined) {
      pc.close();
    }
    channel({ iceServers }, i)
  }, 3000);

  socket.addEventListener('message', function (event) {
    const view = new DataView(event.data);

    switch (view.getUint8(0, true)) {
      case SIGNAL_TYPES.ROLE:
        const role = view.getUint8(1, true);
  
        const open = function (dc) {
          dc.binaryType = 'arraybuffer';
          dc.onopen =  function () {
            clearTimeout(timeout);
            console.log(i, 'open');
            setTimeout(function () {
              socket.close();
              dc.close();
              pc.close()
            }, 1000);
          };
          dc.onclose = function () {
            console.log(i, 'closed');
            setTimeout(function () {
              channel({ iceServers }, i)
            }, 1);
          };
          dc.onmessage = function () {
          };
        }

        pc = new RTCPeerConnection({ iceServers });

        pc.oniceconnectionstatechange = function () {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
          }
        };
  
        pc.ondatachannel = function ({ channel }) {
          const signal = new Uint8Array(1);
          const signalView = new DataView(signal.buffer);
          signalView.setUint8(0, SIGNAL_TYPES.CHANNEL_ESTABLISHED, true);
          socket.send(signal);
          open(channel);
        };

        pc.onicecandidate = function ({ candidate }) {
          if (candidate) {
            const payload = new TextEncoder().encode(JSON.stringify(candidate));
            const signal = new Uint8Array(1 + payload.length);
            const signalView = new DataView(signal.buffer);
            signal.set(payload, 1);
            signalView.setUint8(0, SIGNAL_TYPES.ICE_CANDIDATE, true);
            socket.send(signal.buffer);
          }
        };

        pc.onnegotiationneeded = function () {
          // Caller issues SDP offer
          pc
            .createOffer()
            .then(function (offer) { 
              return pc.setLocalDescription(offer)
            })
            .then(function () {
              const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription))
              const signal = new Uint8Array(1 + payload.length);
              const signalView = new DataView(signal.buffer);
              signal.set(payload, 1);
              signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
              socket.send(signal);
            })
            .catch(console.log);
        };

        if (role === 1) {
          open(pc.createDataChannel('qbc', {
            // udp semantics
            ordered: false,
            maxRetransmits: 0,
          }));
        }
        break;
      case SIGNAL_TYPES.ICE_CANDIDATE:
        const candidate = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.log);
        break;
      case SIGNAL_TYPES.SESSION_DESCRIPTION:
        const sessionDescription = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
        if (sessionDescription.type === 'offer') {
          ;(pc.signalingState !== 'stable'
            ? Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)),
            ])
            : pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)))
              .then(function () {
                // Callee anwsers SDP offer
                return pc.createAnswer()
              })
              .then(function (answer) {
                return pc.setLocalDescription(answer);
              })
              .then(function () {
                const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription))
                const signal = new Uint8Array(1 + payload.length);
                const signalView = new DataView(signal.buffer);
                signal.set(payload, 1);
                signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
                socket.send(signal);
              })
              .catch(console.log);
        } else if (sessionDescription.type === 'answer') {
          pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)).catch(console.log);
        }
        break;
    }
  });

  socket.addEventListener('error', function (error) {
    console.log(error.message);
  });
  
  socket.addEventListener('close', function () {
    if (pc !== undefined) {
      pc.close();
    }
  });
};

for (let i = 0; i < NUMBER_OF_CONNECTIONS; i++) {
  channel({
    iceServers: [
      {
        urls: [
          ICE_SERVER,
        ],
      },
    ],
  }, i);
}