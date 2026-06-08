import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

def main():
    if len(sys.argv) < 2:
        print("Usage: python get_transcript.py <video_id>")
        return

    video_id = sys.argv[1]
    try:
        print(f"Fetching transcript for video: {video_id}...")
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        
        output = []
        for snippet in transcript:
            output.append({
                "text": snippet['text'],
                "start": snippet['start'],
                "duration": snippet['duration']
            })
        
        output_file = f"transcript_{video_id}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
            
        print(f"✅ Success! Transcript saved to {output_file}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
