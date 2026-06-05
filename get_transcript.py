from youtube_transcript_api import YouTubeTranscriptApi
transcript = YouTubeTranscriptApi.get_transcript('1du6w97Rsm4')
for i, t in enumerate(transcript[:100]):
    print(t['text'])
