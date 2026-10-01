import { useEffect, useState } from 'react';

export function UploadThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const image = URL.createObjectURL(file);
    setUrl(image);
    return () => URL.revokeObjectURL(image);
  }, [file]);
  return url ? <img className="upload-thumbnail" src={url} alt="上传图片缩略图" /> : null;
}
