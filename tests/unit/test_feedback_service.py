import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from services.feedback_service.app.services.feedback import FeedbackService
from services.feedback_service.app.schemas.feedback import FeedbackCreate
from services.feedback_service.app.models.feedback import Feedback


class TestFeedbackService(unittest.TestCase):
    def setUp(self):
        self.mock_db = MagicMock()
        self.feedback_service = FeedbackService(db=self.mock_db)

    def test_create_feedback(self):
        """
        Unit test for the create_feedback method.
        """
        org_id = uuid4()
        feedback_data = FeedbackCreate(feedback="Great feedback!")
        
        # Call the method
        result = self.feedback_service.create_feedback(
            feedback_data=feedback_data, organization_id=org_id
        )

        # Assertions
        self.mock_db.add.assert_called_once()
        self.mock_db.commit.assert_called_once()
        self.mock_db.refresh.assert_called_once()
        
        self.assertIsInstance(result, Feedback)
        self.assertEqual(result.feedback, feedback_data.feedback)
        self.assertEqual(result.organization_id, org_id)

    def test_get_all_by_organization(self):
        """
        Unit test for retrieving all feedback for an organization.
        """
        org_id = uuid4()
        
        # Mock the query chain
        mock_feedback = Feedback(id=uuid4(), organization_id=org_id, feedback="Test")
        self.mock_db.query.return_value.filter.return_value.all.return_value = [mock_feedback]

        # Call the method
        result = self.feedback_service.get_all_by_organization(organization_id=org_id)

        # Assertions
        self.mock_db.query.assert_called_with(Feedback)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].organization_id, org_id)

    def test_soft_delete_by_organization(self):
        """
        Unit test for soft-deleting feedback.
        """
        org_id = uuid4()
        
        # Mock the query chain for update
        self.mock_db.query.return_value.filter.return_value.update.return_value = 1

        # Call the method
        num_deleted = self.feedback_service.soft_delete_by_organization(organization_id=org_id)

        # Assertions
        self.mock_db.query.assert_called_with(Feedback)
        self.mock_db.commit.assert_called_once()
        self.assertEqual(num_deleted, 1)

if __name__ == '__main__':
    unittest.main() 