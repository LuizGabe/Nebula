import yt_dlp
import os

def download_youtube_audio():
  url = input("Digite a URL do vídeo do YouTube: ").strip()
  
  ydl_opts = {
    'format': 'bestaudio/best',
    'postprocessors': [{
      'key': 'FFmpegExtractAudio',
      'preferredcodec': 'wav',
      'preferredquality': '192',
    }],
    'outtmpl': '%(id)s',
    'quiet': False,
    'no_warnings': False,
  }
  
  try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
      info = ydl.extract_info(url, download=True)
      video_id = info['id']
      print(f"\n✓ Áudio baixado com sucesso: {video_id}.wav")
  except Exception as e:
    print(f"✗ Erro ao baixar: {e}")

if __name__ == "__main__":
  download_youtube_audio()