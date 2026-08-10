import './globals.css';
import TopNav from './TopNav';

export const metadata = {
  title: 'GGK CPC 대시보드',
  description: '월별 GGK CPC 대시보드 (AM/PM 인원 기준)'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
