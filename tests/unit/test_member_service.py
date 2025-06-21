import unittest
from unittest.mock import MagicMock
from uuid import uuid4
from faker import Faker

from services.member_service.app.services.member import MemberService
from services.member_service.app.schemas.member import MemberCreate
from services.member_service.app.models.member import Member

fake = Faker()

class TestMemberService(unittest.TestCase):
    def setUp(self):
        self.mock_db = MagicMock()
        self.member_service = MemberService(db=self.mock_db)

    def test_create_member(self):
        """
        Unit test for the create_member method.
        """
        org_id = uuid4()
        member_data = MemberCreate(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            login=fake.user_name(),
            avatar_url=fake.image_url(),
            followers=100,
            following=10,
            title=fake.job(),
            email=fake.email(),
        )
        
        result = self.member_service.create_member(
            member_data=member_data, organization_id=org_id
        )

        self.mock_db.add.assert_called_once()
        self.mock_db.commit.assert_called_once()
        self.mock_db.refresh.assert_called_once()

        self.assertIsInstance(result, Member)
        self.assertEqual(result.login, member_data.login)
        self.assertEqual(result.organization_id, org_id)

    def test_get_members_by_organization(self):
        """
        Unit test for retrieving members, ensuring they are sorted by followers.
        """
        org_id = uuid4()
        
        mock_members = [
            Member(id=uuid4(), organization_id=org_id, login="user1", followers=100),
            Member(id=uuid4(), organization_id=org_id, login="user2", followers=200),
        ]
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = sorted(
            mock_members, key=lambda m: m.followers, reverse=True
        )

        result = self.member_service.get_members_by_organization(organization_id=org_id)

        self.mock_db.query.assert_called_with(Member)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].followers, 200) # Verify sort order
        self.assertEqual(result[1].followers, 100)

    def test_soft_delete_by_organization(self):
        """
        Unit test for soft-deleting members.
        """
        org_id = uuid4()
        
        self.mock_db.query.return_value.filter.return_value.update.return_value = 5

        num_deleted = self.member_service.soft_delete_by_organization(organization_id=org_id)

        self.mock_db.query.assert_called_with(Member)
        self.mock_db.commit.assert_called_once()
        self.assertEqual(num_deleted, 5)

if __name__ == '__main__':
    unittest.main() 