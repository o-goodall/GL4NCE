import './globals.css';
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { GlanceProvider } from '@/context/GlanceContext';

export const metadata = { title: 'gl4nce. — Bitcoin DCA Dashboard', description: 'Real-time Bitcoin DCA signal analysis, portfolio tracking, and market intelligence.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <ThemeProvider>
          <SidebarProvider>
            <GlanceProvider>
              {children}
            </GlanceProvider>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
