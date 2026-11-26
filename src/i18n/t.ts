export type AppLang = 'it' | 'en';

function detectLang(): AppLang {
  if (typeof navigator === 'undefined') return 'en';
  const raw =
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    'en';
  return raw.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export const LANG: AppLang = detectLang();

const DICT = {
  it: {
    appTagline: 'Un campionatore facile.',
    appTitle: 'Simpler — Un campionatore facile.',

    // Latency banner
    latencyTitle: 'Bassa latenza:',
    latencyBody: 'togli il silenzioso (iPhone) e usa speaker o cuffie cablate (no Bluetooth).',

    // TopBar & Menu
    bpmDragHint: 'Trascina su/giù per regolare i BPM',
    tapTempoHint: 'Tap Tempo: premi a tempo per impostare i BPM',
    metroHint: 'Metronomo 4/4: tocca per ON/OFF, tieni premuto per il volume',
    metroTitle: 'METRONOMO 4/4',
    metroVolAria: 'Volume metronomo',
    playBeat: 'Play Beat',
    stopBeat: 'Stop Beat',
    shareQrHint: 'Condividi QR Workshop',
    projectMenuHint: 'Menu Progetto',
    menuShareQr: 'Condividi QR Code (Workshop)',
    menuLoadKit: 'Carica Boom Bap Starter Kit (Bank A)',
    menuClearAll: 'Nuovo Progetto Vuoto (Clear All)',

    // Sample View & PadGrid
    micBtnTitle: 'Registra un sample col microfono del telefono o PC',
    volBtnTitle: 'Mostra fader volume e VU meter sui pad',
    importBtnTitle: 'Importa video registrazione schermo (YouTube) o file audio sul pad selezionato',
    importing: 'CARICO...',
    resampleBtnTitle: 'Registra internamente i pad che suoni su un nuovo pad',
    moveBtnTitle: 'Copia o scambia pad',
    recordingOnPad: 'Registrando su {code}...',
    micReadyHint: 'Tieni premuto un pad oppure usa REC ({code})',
    done: 'Fine',
    cancel: 'Annulla',
    resamplingBanner: 'Resampling su {code} — suona i pad!',
    resamplePickTarget: 'Tocca il pad su cui registrare il resample interno.',
    copyPickFirst: 'Tocca il pad da copiare.',
    swapPickFirst: 'Tocca il pad da scambiare.',
    pickTargetPad: 'Ora tocca il pad di destinazione.',
    emptyPad: 'Vuoto',
    emptyPadHint: 'Tieni premuto per Mic · oppure IMPORT',
    holdToRecHint: 'Tieni premuto un pad vuoto per registrare col microfono',
    micReadyToast: 'Microfono pronto! Ora tieni premuto il pad per registrare',
    micDeniedToast: 'Permesso microfono negato. Su iPhone apri il link HTTPS in Safari.',
    micHttpsError: 'Microfono non accessibile in questo browser: apri il link HTTPS in Safari o Chrome.',
    micError: 'Errore microfono',
    recordedToast: 'Registrato su {code} ({sec}s)',
    recTooShort: 'Registrazione troppo breve',
    resampleStarted: 'Resampling su {code}: suona i pad e premi STOP!',
    resampleError: 'Errore resampling',
    resampleSaved: 'Resample salvato su {code} ({sec}s)',
    resampleEmpty: 'Nessun audio catturato nel resample',
    loadedTrimToast: 'Caricato "{name}" ({sec}s) — ritaglia la waveform!',
    unsupportedAudio: 'Formato audio non supportato: {name}',
    sampledFromVideo: 'Campionato da video ({sec}s)',
    padVolumeTitle: 'Trascina su/giù per regolare il volume (doppio tap = 100%)',

    // Sample Editor & Auto-Chop
    padNameAria: 'Nome pad',
    auditionSample: 'Ascolta / Ferma sample',
    closeEditor: 'Chiudi editor',
    emptyEditorMsg: 'Questo pad è vuoto. Registra dal microfono, importa un file audio/video o carica lo Starter Kit.',
    importVideoAudio: 'Importa Video/Audio',
    lazyPlayingToast: 'In riproduzione: premi "+ MARK" a tempo per tagliare!',
    chopTapHint: "Tocca la forma d'onda per ascoltare i singoli slice ({count}).",
    assignToPads: 'Assegna {count} ai Pad',
    noFreePads: 'Nessun pad libero disponibile (svuota un banco prima)',
    slicesAssigned: '{count} slice assegnati ai pad (Choke {choke})',

    // Video Import Modal
    videoModalTitle: 'Campiona da Video',
    videoModalDesc: 'Posiziona il video sul punto che vuoi campionare (es. una registrazione schermo da YouTube) e premi SAMPLE per registrarlo sul pad.',
    videoNodeError: 'Impossibile collegare la traccia audio del video.',
    videoPlayError: 'Errore riproduzione video',
    videoCaptureError: 'Errore cattura audio dal video',
    videoTooShort: 'Spezzone troppo breve: riprova lasciando scorrere il video.',
    pause: 'Pausa',

    // Sequence View & Piano Roll
    clickTitle: "Metronomo 4/4 (tieni premuta l'icona in alto per il volume)",
    quantTitle: 'Allinea automaticamente i colpi a tempo (Quantize)',
    swingTitle: 'Swing Boom Bap',
    editBeatTitle: 'Apri griglia visiva (Piano Roll) per disegnare o correggere il beat',
    wavTitle: 'Scarica il tuo beat in formato WAV',
    notesCount: '{count} note',
    emptySeq: 'Vuota',
    addSeqTitle: 'Aggiungi nuova sequenza',
    barsTitle: 'Lunghezza in battute',
    songTitle: 'Concatena tutte le sequenze piene in ordine (Song Mode)',
    copySeqTitle: 'Copia sequenza negli appunti',
    pasteSeqTitle: 'Incolla sequenza copiata su quella selezionata',
    clearSeqTitle: 'Svuota note della sequenza',
    countInReady: 'Pronti... {beat} / 4 — inizia a suonare i pad!',
    seqRecActive: 'Registrazione attiva su {name}: suona i pad a tempo per aggiungere suoni in loop!',
    eraseTitle: 'Tocca un pad per eliminare i suoi colpi da questa sequenza',
    eraseHint: 'Tocca un pad con × per toglierlo da {name} (puoi sempre fare Undo).',
    removedFromSeq: 'Rimosso "{pad}" da {seq}',
    keysSeqTitle: 'Suona melodie sul pad selezionato e registrali nella sequenza',
    quantFree: 'Quantize: OFF (libero)',
    quantTriplet: 'Quantize: 1/8 Terzine',
    barsSingle: 'battuta',
    barsPlural: 'battute',
    maxSeqReached: 'Massimo 16 sequenze raggiunte',
    seqCopiedToast: 'Copiata {name} — seleziona uno slot e premi Incolla',
    seqPastedToast: 'Incollata su {name}',
    seqCleared: 'Sequenza svuotata',
    notesQuantized: 'Note allineate a 1/{q}',

    // Piano Roll
    prHint: 'Tocca una casella per inserire o rimuovere un colpo. I numeri in alto sono i battiti (1 · 2 · 3 · 4).',
    prSoundCol: 'SUONO',
    prQuantAll: 'Allinea tutte le note a tempo',
    prClose: 'Chiudi Piano Roll',
    prMute: 'Muta traccia',
    prUnmute: 'Riattiva traccia',
    prHitsCount: '({count} colpi)',
    prClearPad: 'Svuota {name}',
    prVelEmpty: 'Tocca la riga di {name} sopra per aggiungere colpi e poi regola qui il loro volume (velocity).',

    // Keyboard Overlay
    kbEmptyPad: 'Pad vuoto',
    kbEmptyMsg: 'Seleziona un pad con un sample caricato (es. Upright Bass, Jazz Chop o Dusty Vibes) per suonarlo sulla tastiera.',
    kbClearNotes: 'Elimina le note di {pad} da {seq}',
    kbClearedToast: 'Cancellate {count} note di {pad}',
    kbClose: 'Chiudi tastiera',

    // Export Modal
    exportTitle: 'Esporta il tuo Beat',
    exportScopeLabel: 'COSA ESPORTARE',
    exportOnlySeq: 'Solo {name} ({count} note)',
    exportFullSong: 'Brano intero ({count} seq)',
    exportLoopsLabel: 'RIPETIZIONI (LOOP)',
    exportEstDur: 'Durata stimata: ~{sec}s · 44.1kHz 16-bit Stereo WAV',
    exportNoNotes: 'Nessuna nota presente nella selezione.',
    exportNeedNotes: 'Registra o inserisci prima qualche nota nel beat!',
    exportRendering: 'Rendering in corso...',
    exportDownloadWav: 'Scarica Beat (.WAV)',
    exportDownloadStems: 'Scarica Tracce Separate (Stems .ZIP)',
    exportedToast: 'Esportato {file}',
    exportedStemsToast: 'Esportati {count} stems in {file}',
    exportWavError: 'Errore export WAV',
    exportStemsError: 'Errore export Stems',

    // Perform FX
    fxLpfHint: 'Taglia alti (Lo-Fi)',
    fxHpfHint: 'Taglia bassi (Drop)',
    fxCrushHint: 'Grana 12-bit SP',
    fxDelayHint: 'Eco Dub a tempo',
    fxReverbHint: 'Spazio / Room',
    fxStutterHint: 'Ripeti a tempo',
    fxHoldTitle: 'Blocca gli effetti nella posizione corrente',
    fxResetTitle: 'Azzera subito tutti gli effetti',
    fxResampleTitle: 'Registra il beat con gli effetti su un pad libero',
    fxResampleSaved: 'Resample FX salvato su {code}',
    fxResampleEmpty: 'Nessun audio catturato',
    fxResampleStart: 'Resampling su {code}: muovi gli effetti e poi premi STOP!',

    // Workshop QR Modal
    qrTitle: 'Simpler — QR Workshop',
    qrGenerating: 'Generazione QR...',
    qrUrlAria: 'URL del QR code',
    qrLocalWarn: 'Questo è un indirizzo locale: per gli studenti in 4G/5G senza Wi-Fi condiviso, usa il link pubblico HTTPS (GitHub / Cloudflare Pages).',
    copyLink: 'Copia Link',
    copied: 'Copiato!',
    linkCopiedToast: 'Link copiato',
    copyManualToast: 'Copia manuale dalla casella URL',
    httpsReady: 'HTTPS Ready (Mic OK)',
    httpsNeeded: 'Serve HTTPS per Mic',

    // Store generic toasts
    copiedToPad: 'Copiato su {code}',
    padsSwapped: 'Pad scambiati',
    sampleNormalized: 'Sample normalizzato',
    sampleCropped: 'Sample ritagliato (Crop)',
    bufferReversed: 'Buffer invertito',
    kitLoaded: 'Boom Bap Kit caricato (Banco A)',
    projectCleared: 'Progetto svuotato',
    undoneToast: 'Annullato (Undo)',
  },

  en: {
    appTagline: 'An easy sampler.',
    appTitle: 'Simpler — An easy sampler.',

    // Latency banner
    latencyTitle: 'Low latency:',
    latencyBody: 'turn off silent mode (iPhone) and use speakers or wired headphones (avoid Bluetooth).',

    // TopBar & Menu
    bpmDragHint: 'Drag up/down to adjust BPM',
    tapTempoHint: 'Tap Tempo: tap in rhythm to set BPM',
    metroHint: '4/4 Metronome: tap for ON/OFF, press & hold for volume',
    metroTitle: '4/4 METRONOME',
    metroVolAria: 'Metronome volume',
    playBeat: 'Play Beat',
    stopBeat: 'Stop Beat',
    shareQrHint: 'Share Workshop QR',
    projectMenuHint: 'Project Menu',
    menuShareQr: 'Share QR Code (Workshop)',
    menuLoadKit: 'Load Boom Bap Starter Kit (Bank A)',
    menuClearAll: 'New Empty Project (Clear All)',

    // Sample View & PadGrid
    micBtnTitle: 'Record a sample using your phone or PC microphone',
    volBtnTitle: 'Show inline volume faders and VU meters on pads',
    importBtnTitle: 'Import a screen-recording video (YouTube) or audio file onto the selected pad',
    importing: 'LOADING...',
    resampleBtnTitle: 'Internally resample the pads you play onto a new pad',
    moveBtnTitle: 'Copy or swap pads',
    recordingOnPad: 'Recording on {code}...',
    micReadyHint: 'Hold any pad or tap REC ({code})',
    done: 'Done',
    cancel: 'Cancel',
    resamplingBanner: 'Resampling to {code} — play your pads!',
    resamplePickTarget: 'Tap the target pad to record your internal resample.',
    copyPickFirst: 'Tap the pad to copy.',
    swapPickFirst: 'Tap the first pad to swap.',
    pickTargetPad: 'Now tap the destination pad.',
    emptyPad: 'Empty',
    emptyPadHint: 'Hold pad for Mic · or tap IMPORT',
    holdToRecHint: 'Hold an empty pad to record from the microphone',
    micReadyToast: 'Mic ready! Now press & hold any pad to record',
    micDeniedToast: 'Microphone permission denied. On iPhone open the HTTPS link in Safari.',
    micHttpsError: 'Microphone unavailable in this browser: open the HTTPS link in Safari or Chrome.',
    micError: 'Microphone error',
    recordedToast: 'Recorded to {code} ({sec}s)',
    recTooShort: 'Recording too short',
    resampleStarted: 'Resampling to {code}: play your pads and hit STOP!',
    resampleError: 'Resampling error',
    resampleSaved: 'Resample saved to {code} ({sec}s)',
    resampleEmpty: 'No audio captured during resample',
    loadedTrimToast: 'Loaded "{name}" ({sec}s) — trim the waveform!',
    unsupportedAudio: 'Unsupported audio format: {name}',
    sampledFromVideo: 'Sampled from video ({sec}s)',
    padVolumeTitle: 'Drag up/down to adjust volume (double-tap = 100%)',

    // Sample Editor & Auto-Chop
    padNameAria: 'Pad name',
    auditionSample: 'Play / Stop sample',
    closeEditor: 'Close editor',
    emptyEditorMsg: 'This pad is empty. Record with the mic, import an audio/video file, or load the Starter Kit.',
    importVideoAudio: 'Import Video/Audio',
    lazyPlayingToast: 'Playing: tap "+ MARK" in rhythm to chop!',
    chopTapHint: 'Tap the waveform to preview individual slices ({count}).',
    assignToPads: 'Assign {count} to Pads',
    noFreePads: 'No empty pads left (clear a bank first)',
    slicesAssigned: '{count} slices assigned to pads (Choke {choke})',

    // Video Import Modal
    videoModalTitle: 'Sample from Video',
    videoModalDesc: 'Scrub the video to the moment you want to sample (e.g. a YouTube screen recording) and press SAMPLE to record it onto the pad.',
    videoNodeError: 'Could not connect to the video audio track.',
    videoPlayError: 'Video playback error',
    videoCaptureError: 'Error capturing audio from video',
    videoTooShort: 'Clip too short: try letting the video play a little longer.',
    pause: 'Pause',

    // Sequence View & Piano Roll
    clickTitle: '4/4 Metronome (hold the top icon to adjust volume)',
    quantTitle: 'Snap hits automatically to the beat (Quantize)',
    swingTitle: 'Boom Bap Swing',
    editBeatTitle: 'Open visual beat grid (Piano Roll) to draw or edit notes',
    wavTitle: 'Download your beat as WAV',
    notesCount: '{count} notes',
    emptySeq: 'Empty',
    addSeqTitle: 'Add new sequence',
    barsTitle: 'Length in bars',
    songTitle: 'Chain all non-empty sequences in order (Song Mode)',
    copySeqTitle: 'Copy sequence to clipboard',
    pasteSeqTitle: 'Paste copied sequence onto the selected slot',
    clearSeqTitle: 'Clear sequence notes',
    countInReady: 'Get ready... {beat} / 4 — start playing the pads!',
    seqRecActive: 'Recording on {name}: tap pads in rhythm to overdub in a loop!',
    eraseTitle: 'Tap a pad to erase its hits from this sequence',
    eraseHint: 'Tap a pad marked with × to remove it from {name} (Undo works anytime).',
    removedFromSeq: 'Removed "{pad}" from {seq}',
    keysSeqTitle: 'Play melodies on the selected pad and record them into the sequence',
    quantFree: 'Quantize: OFF (free)',
    quantTriplet: 'Quantize: 1/8 Triplets',
    barsSingle: 'bar',
    barsPlural: 'bars',
    maxSeqReached: 'Maximum of 16 sequences reached',
    seqCopiedToast: 'Copied {name} — select a slot and tap Paste',
    seqPastedToast: 'Pasted onto {name}',
    seqCleared: 'Sequence cleared',
    notesQuantized: 'Notes quantized to 1/{q}',

    // Piano Roll
    prHint: 'Tap any cell to add or remove a hit. Numbers at the top are beats (1 · 2 · 3 · 4).',
    prSoundCol: 'SOUND',
    prQuantAll: 'Quantize all notes to grid',
    prClose: 'Close Piano Roll',
    prMute: 'Mute track',
    prUnmute: 'Unmute track',
    prHitsCount: '({count} hits)',
    prClearPad: 'Clear {name}',
    prVelEmpty: 'Tap the {name} row above to add hits, then adjust their volume (velocity) here.',

    // Keyboard Overlay
    kbEmptyPad: 'Empty pad',
    kbEmptyMsg: 'Select a pad with a loaded sample (e.g. Upright Bass, Jazz Chop, or Dusty Vibes) to play it on the keyboard.',
    kbClearNotes: 'Remove {pad} notes from {seq}',
    kbClearedToast: 'Cleared {count} notes of {pad}',
    kbClose: 'Close keyboard',

    // Export Modal
    exportTitle: 'Export Your Beat',
    exportScopeLabel: 'WHAT TO EXPORT',
    exportOnlySeq: 'Only {name} ({count} notes)',
    exportFullSong: 'Full song ({count} seq)',
    exportLoopsLabel: 'REPEATS (LOOPS)',
    exportEstDur: 'Estimated length: ~{sec}s · 44.1kHz 16-bit Stereo WAV',
    exportNoNotes: 'No notes in the current selection.',
    exportNeedNotes: 'Record or draw some notes in your beat first!',
    exportRendering: 'Rendering...',
    exportDownloadWav: 'Download Beat (.WAV)',
    exportDownloadStems: 'Download Separate Tracks (Stems .ZIP)',
    exportedToast: 'Exported {file}',
    exportedStemsToast: 'Exported {count} stems to {file}',
    exportWavError: 'WAV export error',
    exportStemsError: 'Stems export error',

    // Perform FX
    fxLpfHint: 'Cut highs (Lo-Fi)',
    fxHpfHint: 'Cut lows (Drop)',
    fxCrushHint: '12-bit SP Grit',
    fxDelayHint: 'Tempo Dub Echo',
    fxReverbHint: 'Warm Studio Room',
    fxStutterHint: 'Tempo Beat Repeat',
    fxHoldTitle: 'Lock effects at their current positions',
    fxResetTitle: 'Reset all active effects immediately',
    fxResampleTitle: 'Record the effected beat onto a free pad',
    fxResampleSaved: 'FX resample saved to {code}',
    fxResampleEmpty: 'No audio captured',
    fxResampleStart: 'Resampling to {code}: move the FX faders and press STOP!',

    // Workshop QR Modal
    qrTitle: 'Simpler — Workshop QR',
    qrGenerating: 'Generating QR...',
    qrUrlAria: 'QR code URL',
    qrLocalWarn: 'This is a local address: for students on 4G/5G without shared Wi-Fi, use the public HTTPS link (GitHub / Cloudflare Pages).',
    copyLink: 'Copy Link',
    copied: 'Copied!',
    linkCopiedToast: 'Link copied',
    copyManualToast: 'Copy manually from the URL field',
    httpsReady: 'HTTPS Ready (Mic OK)',
    httpsNeeded: 'HTTPS Needed for Mic',

    // Store generic toasts
    copiedToPad: 'Copied to {code}',
    padsSwapped: 'Pads swapped',
    sampleNormalized: 'Sample normalized',
    sampleCropped: 'Sample cropped',
    bufferReversed: 'Buffer reversed',
    kitLoaded: 'Boom Bap Kit loaded (Bank A)',
    projectCleared: 'Project cleared',
    undoneToast: 'Undone',
  },
} as const;

export type I18nKey = keyof typeof DICT.it;

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let str: string = DICT[LANG][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function applyDocumentLocale(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANG;
  document.title = t('appTitle');
}
