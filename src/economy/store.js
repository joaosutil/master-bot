// Mini "banco" em memória (por enquanto)
export const users = new Map();

// Garante que o usuário exista e devolve o registro
export function getUser(userId) {
  const record = users.get(userId) ?? { balance: 0, lastDaily: 0 };
  users.set(userId, record);
  return record;
}
