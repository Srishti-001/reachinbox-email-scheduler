import { User } from './src/types';

declare global {
  namespace Express {
    // Passport serialises req.user as Express.User.
    // Merging our User interface here makes req.user fully typed everywhere.
    interface User extends import('./src/types').User {}
  }
}
