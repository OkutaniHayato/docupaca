"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation'; // 
import { useAuth } from '@/context/AuthContext'; // 
import { 
  LayoutDashboard, 
  Settings, 
  History, 
  KeyRound, 
  LogOut // 
} from 'lucide-react'; // 

// 
const menuItems = [
  { 
    name: 'ダッシュボード', 
    href: '/dashboard', 
    icon: LayoutDashboard 
  },
  { 
    name: 'OCR設定', 
    href: '/dashboard/settings', 
    icon: Settings 
  },
  { 
    name: '実行履歴', 
    href: '/dashboard/history', 
    icon: History 
  },
  { 
    name: 'APIキー', 
    href: '/dashboard/apikeys', 
    icon: KeyRound 
  },
];

export default function SidebarNav() {
  const pathname = usePathname(); // 
  const { logout } = useAuth(); // 

  return (
    <div className="flex h-full flex-col justify-between">
      {/* ---  --- */}
      <nav className="mt-4">
        {menuItems.map((item) => {
          const isActive = pathname === item.href; // 
          return (
            <Link
              key={item.name}
              href={item.href}
              // 
              className={`flex items-center rounded px-4 py-2.5 transition duration-200 ${
                isActive
                  ? 'bg-green-700 text-white' // 
                  : 'text-white hover:bg-green-700'
              }`}
            >
              <item.icon className="mr-3 h-5 w-5" /> {/* */}
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* ---  --- */}
      <div>
        <button
          onClick={() => logout()} // 
          className="flex w-full items-center rounded px-4 py-2.5 text-white transition duration-200 hover:bg-green-700"
        >
          <LogOut className="mr-3 h-5 w-5" /> {/* */}
          ログアウト
        </button>
      </div>
    </div>
  );
}