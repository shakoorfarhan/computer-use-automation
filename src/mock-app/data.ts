export interface SubAccount {
  id: string;
  name: string;
  balance: number;
}

export interface Member {
  id: string;
  name: string;
  status: "active" | "frozen";
  savings: { number: string; balance: number };
  checking: { number: string; balance: number };
  subAccounts: SubAccount[];
}

export const members: Member[] = [
  {
    id: "10023",
    name: "Alice Nakamura",
    status: "active",
    savings: { number: "SV-10023-01", balance: 4820.55 },
    checking: { number: "CK-10023-01", balance: 1290.1 },
    subAccounts: [{ id: "SA-10023-01", name: "Vacation Fund", balance: 600 }],
  },
  {
    id: "10047",
    name: "Marcus Webb",
    status: "active",
    savings: { number: "SV-10047-01", balance: 152.0 },
    checking: { number: "CK-10047-01", balance: 88.42 },
    subAccounts: [],
  },
  {
    id: "10099",
    name: "Priya Chandrasekaran",
    status: "frozen",
    savings: { number: "SV-10099-01", balance: 9310.0 },
    checking: { number: "CK-10099-01", balance: 430.0 },
    subAccounts: [
      { id: "SA-10099-01", name: "Tax Reserve", balance: 2000 },
      { id: "SA-10099-02", name: "Emergency Fund", balance: 1500 },
    ],
  },
  {
    id: "10112",
    name: "David Otieno",
    status: "active",
    savings: { number: "SV-10112-01", balance: 63.2 },
    checking: { number: "CK-10112-01", balance: 12.05 },
    subAccounts: [],
  },
];

export function findMemberById(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}

export function searchMembers(query: string): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return members.filter(
    (m) => m.id.includes(q) || m.name.toLowerCase().includes(q)
  );
}

let subAccountCounter = 1000;
export function openSubAccount(memberId: string, name: string): SubAccount | undefined {
  const member = findMemberById(memberId);
  if (!member) return undefined;
  const sub: SubAccount = {
    id: `SA-${memberId}-${subAccountCounter++}`,
    name,
    balance: 0,
  };
  member.subAccounts.push(sub);
  return sub;
}
