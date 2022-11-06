// NOTE: To change between p2p mode and client to server mode, change the code at the bottom

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function gatheringComplete(pc) {
    return new Promise(function(resolve) {
        if (pc.iceGatheringState === 'complete') {
            resolve();
        } else {
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') {
                    resolve();
                };
            });
        }
    });
}

async function createOfferSetLocalAndWaitForGatheringComplete(pc) {
    var offer = pc.createOffer();
    await pc.setLocalDescription(offer);
    await gatheringComplete(pc);
    offer = pc.localDescription;
    return offer;
}

async function setRemoteCreateAnswerAndWaitForGatheringComplete(pc, offer) {
    await pc.setRemoteDescription(offer);
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await gatheringComplete(pc);
    return answer;
}

async function configureTwoLocalPeerConnections(offerer, answerer) {
    var offer = await createOfferSetLocalAndWaitForGatheringComplete(offerer);
    var answer = await setRemoteCreateAnswerAndWaitForGatheringComplete(answerer, offer);
    await offerer.setRemoteDescription(answer);
}

class SingleTransceiverEncodedFrameFactory {
    constructor(encodedFramesReader, cachedEncodedFrameTargetCount) {
        this.cachedEncodedFrames = [];
        this.stopped = false;

        (async () => {
            while(!this.stopped) {
                const encodedFrame = (await encodedFramesReader.read()).value;
                this.cachedEncodedFrames.push(encodedFrame);
            }
        })();
    }

    popCachedEncodedFrame() {
        if (this.cachedEncodedFrames.length > 0) {
            return this.cachedEncodedFrames.shift();
        }
        return null;
    }

    stop() {
        this.stopped = true;
    }
}

class DummyPeerConnectionsEncodedFrameFactory {
    constructor(trackCount, cachedEncodedFrameTargetCount) {
        this.cachedEncodedFrames = [];
        this.stopped = false;

        const pcConfig = {
            encodedInsertableStreams: true,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
        };
        const senderPc = new RTCPeerConnection(pcConfig);
        const receiverPc = new RTCPeerConnection(pcConfig);
        const trackGenerator = new MediaStreamTrackGenerator({ kind: 'audio' });
        const trackWriter = trackGenerator.writable.getWriter();
        for (var i = 0; i < trackCount; i++) {
            const senderTransceiver = senderPc.addTransceiver(trackGenerator, {direction: 'sendonly'});
            receiverPc.addTransceiver("audio", {direction: 'recvonly'});
            const encodedFramesReader = senderTransceiver.sender.createEncodedStreams().readable.getReader();
            (async () => {
                while(!this.stopped) {
                    const encodedFrame = (await encodedFramesReader.read()).value;
                    this.cachedEncodedFrames.push(encodedFrame);    
                }
            })();
        }
        (async() => {
            await configureTwoLocalPeerConnections(senderPc, receiverPc);
            // TODO: Wait until connected
            const fakeFrameData = new ArrayBuffer(1920);
            while(!this.stopped) {
                await sleep(1);
                if (this.cachedEncodedFrames.length < cachedEncodedFrameTargetCount) {
                    const fakeFrame = new AudioData({format: "f32-planar", sampleRate: 48000, numberOfFrames: 480, numberOfChannels: 1, timestamp: 1, data: fakeFrameData,});
                    trackWriter.write(fakeFrame);
                }
            }
            senderPc.close();
            receiverPc.close();
        })();
    }

    popCachedEncodedFrame() {
        if (this.cachedEncodedFrames.length > 0) {
            return this.cachedEncodedFrames.shift();
        }
        return null;
    }

    stop() {
        this.stopped = true;
    }
}

class PacketSender {
    constructor(transceiver, trackCount, cachedEncodedFrameTargetCount) {
        const encodedStreams = transceiver.sender.createEncodedStreams();
        this.encodedFrameWriter = encodedStreams.writable.getWriter();
        if (trackCount == 1) {
            const encodedFrameReader = encodedStreams.readable.getReader();
            this.encodedFrameFactory = new SingleTransceiverEncodedFrameFactory(encodedFrameReader, cachedEncodedFrameTargetCount);
        } else {
            this.encodedFrameFactory = new EncodedFrameFactory(trackCount, cachedEncodedFrameTargetCount);
        }
    }
    
    send(data) {
        const encodedFrame = this.encodedFrameFactory.popCachedEncodedFrame();
        if (encodedFrame) {
            encodedFrame.data = data;
            console.log(encodedFrame);
            this.encodedFrameWriter.write(encodedFrame);
        } else {
            console.log(`Failed to send packet because there aren't enough cached encoded frames.`);
        }
    }
    
    stop() {
        this.encodedFrameFactory.stop();
    }
}

class PacketReceiver {
    constructor(transceiver) {
        const encodedStreams = transceiver.receiver.createEncodedStreams();
        this.encodedFrameReader = encodedStreams.readable.getReader();
    }
    
    async receive() {
        const encodedFrame = (await this.encodedFrameReader.read()).value;
        return encodedFrame;
    }
}

async function mainP2p() {
    const pcConfig = {
        encodedInsertableStreams: true,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        sdpSemantics: 'unified-plan'
    };
    const senderPc = new RTCPeerConnection(pcConfig);
    const trackGenerator = new MediaStreamTrackGenerator({ kind: 'audio' });
    const senderTransceiver = senderPc.addTransceiver(trackGenerator, {direction: 'sendonly'});

    // %%%% WORK IN PROGRESS
    const fakeFrameData = new ArrayBuffer(1920);
    while(!this.stopped) {
        await sleep(1);
        if (this.cachedEncodedFrames.length < cachedEncodedFrameTargetCount) {
            const fakeFrame = new AudioData({format: "f32-planar", sampleRate: 48000, numberOfFrames: 480, numberOfChannels: 1, timestamp: 1, data: fakeFrameData,});
            trackWriter.write(fakeFrame);
        }
    }

    const receiverPc = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        sdpSemantics: 'unified-plan'
    });
    const receiverTransceiver = receiverPc.addTransceiver("audio", {direction: 'recvonly'});

    await configureTwoLocalPeerConnections(senderPc, receiverPc);

    // const packetReceiver = new PacketReceiver(receiverTransceiver);
    // (async() => {
    //     for (var i = 0; i < 1000; i++) {
    //         const received = await packetReceiver.receive();
    //         console.log(received);
    //     }
    // });

    const packetSender = new PacketSender(senderTransceiver, 1, 200);
    for (var i = 0; i < 2000; i++) {
        await sleep(1);
        const data = new ArrayBuffer(100);
        const view = new Uint8Array(data);
        view[0] = i;
        view[99] = i+1;
        packetSender.send(data);
    }	
}

async function doOfferAnswerExchangeWithServer(offer) {
    const response = await fetch('/offer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sdp: offer.sdp,
            type: offer.type,
            video_transform: "",
        })
    });
    const answer = await response.json();
    return answer;
}

async function mainClientServer() {
    const pc = new RTCPeerConnection({
        encodedInsertableStreams: true,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        sdpSemantics: 'unified-plan',
    });
    const transceiver = pc.addTransceiver(new MediaStreamTrackGenerator({ kind: 'audio' }));
    var offer = await createOfferSetLocalAndWaitForGatheringComplete(pc);
    const answer = await doOfferAnswerExchangeWithServer(offer);
    await pc.setRemoteDescription(answer);

    const packetReceiver = new PacketReceiver(transceiver);
    (async() => {
        for (var i = 0; i < 1000; i++) {
            const received = await packetReceiver.receive();
            console.log(received);
        }
    });

    const packetSender = new PacketSender(transceiver, 10, 1000);
    for (var i = 0; i < 1000; i++) {
        await sleep(1);
        const data = new ArrayBuffer(100);
        const view = new Uint8Array(data);
        view[0] = i;
        view[99] = i+1;
        packetSender.send(data);
    }
}

mainP2p();
// mainClientServer();
