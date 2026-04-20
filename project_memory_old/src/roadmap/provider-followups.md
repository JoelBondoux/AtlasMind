# Provider Integration Follow-Ups

Status: Updated 2026-04-06
Updated: 2026-04-06

## Completed

- ✅ Implemented EXA search integration end-to-end (`exa-search` skill, v0.37.0).
- ✅ Expanded Amazon Bedrock model metadata with 16 additional entries (v0.37.0): Claude 3.5 Haiku, Claude 3 Haiku, Claude 3 Opus, Amazon Nova Micro, Amazon Titan Text Express and Lite, Cohere Command R and R+, Mistral 7B and 8x7B, Llama 3.2 1B/3B/11B/90B, AI21 Jamba 1.5 Mini/Large.
- ✅ Implemented ElevenLabs TTS integration (v0.38.0): `VoiceManager` calls the ElevenLabs API server-side when an API key is configured, streams base64-encoded MP3 to the Voice Panel, falls back to Web Speech API.
