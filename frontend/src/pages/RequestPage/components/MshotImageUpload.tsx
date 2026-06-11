import React from 'react';

interface MshotImageUploadProps {
  fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom';
  value: string;
  error?: string;
  disabled: boolean;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => void;
}

const MshotImageUpload: React.FC<MshotImageUploadProps> = ({ fieldName, value, error, disabled, onPaste }) => (
  <div>
    <div
      className="image-upload-area"
      style={{
        border: `2px dashed ${error ? '#dc3545' : '#ccc'}`,
        borderRadius: '8px',
        padding: '20px',
        textAlign: 'center',
        minHeight: '100px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: error ? '#fff5f5' : '#f9f9f9',
      }}
      onPaste={disabled ? undefined : (e) => onPaste(e, fieldName)}
    >
      {value ? (
        <div style={{ width: '100%' }}>
          <img
            src={`/media/${value}`}
            alt="attached"
            style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', border: '1px solid #ddd' }}
          />
          <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '13px' }}>
            이미지가 첨부되었습니다. Ctrl+V 로 다시 붙여넣으면 변경됩니다.
          </p>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📋</div>
          <p style={{ margin: '0', color: '#666' }}>Ctrl+V 로 이미지를 붙여넣으세요</p>
        </div>
      )}
    </div>
    {error && <span className="form-error">{error}</span>}
  </div>
);

export default MshotImageUpload;
