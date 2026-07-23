// Agent H, sourcing sidebar (2026-07-21): browser-native speech-to-text so
// a recruiter can talk instead of typing their request. Deliberately the
// browser's own SpeechRecognition API, not a server-side transcription
// vendor -- Harsha's ask was specifically "if it's hard engineering, skip
// it," and this is a few lines with no new backend cost. Chrome/Edge
// support it natively; Safari/Firefox support is weaker, so the hook
// exposes isSupported and the caller (SourcingSidebar) hides the mic
// button entirely when unsupported rather than showing a broken control.
import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const getSpeechRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

export const useVoiceInput = (onResult: (transcript: string) => void) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const Ctor = getSpeechRecognitionCtor();
  const isSupported = Ctor != null;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleListening = () => {
    if (!Ctor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return { isSupported, isListening, toggleListening };
};
